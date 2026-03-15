import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Maps a StoreEntity to the StoreInfo shape expected by the POS frontend.
 * Key mapping: entity.name → storeName
 * Shared by AuthService (login response) and StoresService (GET /stores/me/info).
 */
export function mapStoreEntityToStoreInfo(store: StoreEntity) {
  return {
    storeName: store.name,
    address: store.address || '',
    postalCode: store.postalCode || '',
    city: store.city || '',
    phone: store.phone || '',

    siret: store.siret || '',
    siren: store.siren || '',
    naf: store.naf || '',
    tvaIntracom: store.tvaIntracom || '',
    rcs: store.rcs || '',
    capitalSocial: store.capitalSocial || '',
    formeJuridique: store.formeJuridique || '',

    softwareName: store.softwareName || 'CAISSE POS',
    softwareVersion: store.softwareVersion || '1.0.0',
    nifCaisse: store.nifCaisse || '',

    headerMessage: store.headerMessage || null,
    footerMessage: store.footerMessage || null,
  };
}
