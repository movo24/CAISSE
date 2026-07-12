import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AttractCampaignEntity } from '../../database/entities/attract-campaign.entity';
import { AttractMediaEntity } from '../../database/entities/attract-media.entity';
import {
  CreateAttractCampaignDto,
  UpdateAttractCampaignDto,
  AttractMediaItemDto,
} from './attract.dto';

export interface ResolvedPlaylist {
  campaignId: string;
  name: string;
  loop: boolean;
  media: Array<{ type: 'video' | 'image'; url: string; durationSeconds: number | null; position: number }>;
}

/**
 * Bloc 4 — service de gestion du contenu attract (campagnes + playlists) et
 * résolveur diffusé à la caisse.
 *
 * Autorisation :
 *  - un manager gère les campagnes de SON magasin ;
 *  - les campagnes nationales (storeId NULL) sont réservées aux admins ;
 *  - tout le monde (staff authentifié) peut lire la playlist résolue de sa
 *    caisse (l'écran client la consomme).
 */
@Injectable()
export class AttractService {
  constructor(
    @InjectRepository(AttractCampaignEntity)
    private readonly campaignRepo: Repository<AttractCampaignEntity>,
    @InjectRepository(AttractMediaEntity)
    private readonly mediaRepo: Repository<AttractMediaEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private isAdmin(role?: string): boolean {
    return role === 'admin';
  }

  /** Un manager ne peut pas toucher une campagne nationale ni celle d'un autre magasin. */
  private assertCanManage(campaign: AttractCampaignEntity, storeId: string, role?: string): void {
    if (this.isAdmin(role)) return;
    if (campaign.storeId === null) {
      throw new ForbiddenException('Les campagnes nationales sont réservées aux administrateurs.');
    }
    if (campaign.storeId !== storeId) {
      throw new ForbiddenException('Cette campagne appartient à un autre magasin.');
    }
  }

  private parseDate(v?: string | null): Date | null {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Campagnes visibles par le magasin : les siennes + les nationales. */
  async list(storeId: string): Promise<Array<AttractCampaignEntity & { mediaCount: number }>> {
    const campaigns = await this.campaignRepo
      .createQueryBuilder('c')
      .where('c.store_id = :storeId OR c.store_id IS NULL', { storeId })
      .orderBy('c.priority', 'DESC')
      .addOrderBy('c.created_at', 'DESC')
      .getMany();
    const result: Array<AttractCampaignEntity & { mediaCount: number }> = [];
    for (const c of campaigns) {
      const mediaCount = await this.mediaRepo.count({ where: { campaignId: c.id } });
      result.push(Object.assign(c, { mediaCount }));
    }
    return result;
  }

  async get(id: string, storeId: string): Promise<AttractCampaignEntity> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign || (campaign.storeId !== null && campaign.storeId !== storeId)) {
      throw new NotFoundException('Campagne introuvable.');
    }
    const media = await this.mediaRepo.find({ where: { campaignId: id }, order: { position: 'ASC' } });
    return Object.assign(campaign, { media });
  }

  async create(storeId: string, role: string | undefined, dto: CreateAttractCampaignDto): Promise<AttractCampaignEntity> {
    const national = dto.scope === 'national';
    if (national && !this.isAdmin(role)) {
      throw new ForbiddenException('Seul un administrateur peut créer une campagne nationale.');
    }
    const campaign = this.campaignRepo.create({
      storeId: national ? null : storeId,
      name: dto.name,
      isActive: dto.isActive ?? true,
      startsAt: this.parseDate(dto.startsAt),
      endsAt: this.parseDate(dto.endsAt),
      priority: dto.priority ?? 0,
      terminalIds: dto.terminalIds && dto.terminalIds.length ? dto.terminalIds : null,
      loop: dto.loop ?? true,
    });
    const saved = await this.campaignRepo.save(campaign);
    if (dto.media && dto.media.length) {
      await this.replaceMedia(saved.id, dto.media);
    }
    return this.get(saved.id, storeId);
  }

  async update(id: string, storeId: string, role: string | undefined, dto: UpdateAttractCampaignDto): Promise<AttractCampaignEntity> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campagne introuvable.');
    this.assertCanManage(campaign, storeId, role);

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.isActive !== undefined) campaign.isActive = dto.isActive;
    if (dto.startsAt !== undefined) campaign.startsAt = this.parseDate(dto.startsAt);
    if (dto.endsAt !== undefined) campaign.endsAt = this.parseDate(dto.endsAt);
    if (dto.priority !== undefined) campaign.priority = dto.priority;
    if (dto.terminalIds !== undefined) campaign.terminalIds = dto.terminalIds && dto.terminalIds.length ? dto.terminalIds : null;
    if (dto.loop !== undefined) campaign.loop = dto.loop;
    await this.campaignRepo.save(campaign);
    return this.get(id, storeId);
  }

  async remove(id: string, storeId: string, role: string | undefined): Promise<{ deleted: true }> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campagne introuvable.');
    this.assertCanManage(campaign, storeId, role);
    await this.campaignRepo.delete({ id }); // media supprimés en cascade (FK ON DELETE CASCADE)
    return { deleted: true };
  }

  async setMedia(id: string, storeId: string, role: string | undefined, items: AttractMediaItemDto[]): Promise<AttractCampaignEntity> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campagne introuvable.');
    this.assertCanManage(campaign, storeId, role);
    await this.replaceMedia(id, items);
    return this.get(id, storeId);
  }

  /** Remplace intégralement la playlist d'une campagne, en préservant l'ordre du tableau. */
  private async replaceMedia(campaignId: string, items: AttractMediaItemDto[]): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      await m.delete(AttractMediaEntity, { campaignId });
      const rows = items.map((it, idx) =>
        m.create(AttractMediaEntity, {
          campaignId,
          position: idx,
          type: it.type,
          url: it.url,
          durationSeconds: it.durationSeconds ?? null,
        }),
      );
      if (rows.length) await m.save(rows);
    });
  }

  /**
   * Résolveur consommé par l'écran client : rend la playlist active pour une
   * caisse donnée, à un instant donné. Priorité : campagne du magasin avant
   * nationale, puis priority décroissante. Renvoie null si aucune campagne
   * active avec au moins un média.
   */
  async resolvePlaylist(storeId: string, terminalId: string | null, now: Date = new Date()): Promise<ResolvedPlaylist | null> {
    const candidates = await this.campaignRepo
      .createQueryBuilder('c')
      .where('(c.store_id = :storeId OR c.store_id IS NULL)', { storeId })
      .andWhere('c.is_active = true')
      .andWhere('(c.starts_at IS NULL OR c.starts_at <= :now)', { now })
      .andWhere('(c.ends_at IS NULL OR c.ends_at >= :now)', { now })
      .getMany();

    // Ciblage caisse + tri (magasin avant national, puis priorité, puis récence) en JS
    // pour rester robuste (jsonb non uniformément supporté selon le backend SQL).
    const matching = candidates
      .filter((c) => !c.terminalIds || c.terminalIds.length === 0 || (terminalId != null && c.terminalIds.includes(terminalId)))
      .sort((a, b) => {
        const aStore = a.storeId === null ? 1 : 0;
        const bStore = b.storeId === null ? 1 : 0;
        if (aStore !== bStore) return aStore - bStore; // magasin (0) avant national (1)
        if (a.priority !== b.priority) return b.priority - a.priority;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    for (const campaign of matching) {
      const media = await this.mediaRepo.find({ where: { campaignId: campaign.id }, order: { position: 'ASC' } });
      if (media.length) {
        return {
          campaignId: campaign.id,
          name: campaign.name,
          loop: campaign.loop,
          media: media.map((mm) => ({ type: mm.type, url: mm.url, durationSeconds: mm.durationSeconds, position: mm.position })),
        };
      }
    }
    return null;
  }
}
