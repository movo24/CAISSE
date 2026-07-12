import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttractMediaItemDto {
  @ApiProperty({ enum: ['video', 'image'] })
  @IsIn(['video', 'image'])
  type: 'video' | 'image';

  @ApiProperty({ description: 'URL (http/https) ou data-URI de la vidéo/image' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({ description: 'Durée en secondes (images / cap vidéo)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}

export class CreateAttractCampaignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: ['store', 'national'], default: 'store', description: "'national' réservé aux admins" })
  @IsOptional()
  @IsIn(['store', 'national'])
  scope?: 'store' | 'national';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601, null = pas de début imposé' })
  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601, null = pas de fin' })
  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @ApiPropertyOptional({ default: 0, description: 'Priorité (plus haut = gagne)' })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ type: [String], description: 'Caisses ciblées (terminalId). Vide/absent = toutes.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  terminalIds?: string[] | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @ApiPropertyOptional({ type: [AttractMediaItemDto], description: 'Playlist ordonnée (ordre = ordre du tableau)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttractMediaItemDto)
  media?: AttractMediaItemDto[];
}

export class UpdateAttractCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  terminalIds?: string[] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  loop?: boolean;
}

export class SetAttractMediaDto {
  @ApiProperty({ type: [AttractMediaItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttractMediaItemDto)
  media: AttractMediaItemDto[];
}
