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
    addressExtra: store.addressExtra || '',
    postalCode: store.postalCode || '',
    city: store.city || '',
    country: store.country || '',
    phone: store.phone || '',
    email: store.email || '',
    websiteUrl: store.websiteUrl || '',
    operatingCompanyName: store.operatingCompanyName || '',

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

    // Refonte ticket The Wesley — réglages pilotés par le Dashboard.
    receiptLogoUrl: store.receiptLogoUrl || null,
    receiptQrEnabled: store.receiptQrEnabled ?? true,
    receiptQrText: store.receiptQrText || null,
    receiptFinalMessage: store.receiptFinalMessage || null,
    receiptPublicBaseUrl: store.receiptPublicBaseUrl || null,
  };
}
