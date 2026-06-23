import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';

// ---------------------------------------------------------------------------
// Notification types
// ---------------------------------------------------------------------------
export interface LoyaltyReminder {
  customerId: string;
  customerName: string;
  qrCode: string;
  loyaltyPoints: number;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  message: string;
  priority: 'high' | 'medium' | 'low';
}

export interface StockNotification {
  productId: string;
  productName: string;
  ean: string;
  stockQuantity: number;
  alertThreshold: number;
  criticalThreshold: number;
  level: 'alert' | 'critical' | 'out_of_stock';
  message: string;
}

export interface NotificationSummary {
  generatedAt: string;
  loyaltyReminders: LoyaltyReminder[];
  stockNotifications: StockNotification[];
  stats: {
    totalInactiveCustomers: number;
    totalStockAlerts: number;
    totalCriticalStock: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customersRepo: Repository<CustomerEntity>,

    @InjectRepository(SaleEntity)
    private readonly salesRepo: Repository<SaleEntity>,

    @InjectRepository(ProductEntity)
    private readonly productsRepo: Repository<ProductEntity>,
  ) {}

  // -----------------------------------------------------------------------
  // QR Loyalty reminders — find customers who haven't visited recently
  // FIXED: tenant-scoped (storeId filter) + single query instead of N+1
  // -----------------------------------------------------------------------
  async getLoyaltyReminders(
    storeId: string,
    inactiveDays = 30,
  ): Promise<LoyaltyReminder[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

    // Single query: LEFT JOIN to get last sale date per customer
    // instead of N+1 individual queries
    const customersWithLastSale = await this.customersRepo
      .createQueryBuilder('c')
      .leftJoin(
        (qb) =>
          qb
            .select('s.customer_id', 'customer_id')
            .addSelect('MAX(s.created_at)', 'last_visit')
            .from(SaleEntity, 's')
            .where('s.store_id = :storeId', { storeId })
            .andWhere('s.status = :status', { status: 'completed' })
            .groupBy('s.customer_id'),
        'ls',
        'ls.customer_id = c.id',
      )
      .addSelect('ls.last_visit', 'lastVisit')
      .where('c.store_id = :storeId', { storeId })
      .andWhere('c.is_verified = true')
      .getRawAndEntities();

    const reminders: LoyaltyReminder[] = [];

    for (let i = 0; i < customersWithLastSale.entities.length; i++) {
      const customer = customersWithLastSale.entities[i];
      const raw = customersWithLastSale.raw[i];
      const lastVisitDate: Date | null = raw.lastVisit
        ? new Date(raw.lastVisit)
        : null;

      let daysSinceLastVisit: number | null = null;
      if (lastVisitDate) {
        daysSinceLastVisit = Math.floor(
          (Date.now() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24),
        );
      }

      // Include if never visited or inactive for > inactiveDays
      const isInactive =
        lastVisitDate === null || daysSinceLastVisit! >= inactiveDays;

      if (!isInactive) continue;

      // Determine priority
      let priority: 'high' | 'medium' | 'low' = 'low';
      let message = '';

      if (lastVisitDate === null) {
        priority = 'medium';
        message = `${customer.firstName} n'a jamais effectue d'achat. Envoyez un rappel QR avec offre de bienvenue (-5%).`;
      } else if (daysSinceLastVisit! >= 90) {
        priority = 'high';
        message = `${customer.firstName} n'est pas venu(e) depuis ${daysSinceLastVisit} jours. Client a risque de perte.`;
      } else if (daysSinceLastVisit! >= 60) {
        priority = 'medium';
        message = `${customer.firstName} absent(e) depuis ${daysSinceLastVisit} jours. Un rappel QR est recommande.`;
      } else {
        priority = 'low';
        message = `${customer.firstName} inactif(ve) depuis ${daysSinceLastVisit} jours. Suggestion de rappel.`;
      }

      // Bonus: high points -> higher priority
      if (customer.loyaltyPoints >= 100 && priority !== 'high') {
        priority = 'high';
        message += ` Client fidele (${customer.loyaltyPoints} points).`;
      }

      reminders.push({
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        qrCode: customer.qrCode,
        loyaltyPoints: customer.loyaltyPoints,
        lastVisitDate: lastVisitDate ? lastVisitDate.toISOString() : null,
        daysSinceLastVisit,
        message,
        priority,
      });
    }

    // Sort by priority: high > medium > low, then by days since last visit
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    reminders.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return (b.daysSinceLastVisit ?? 999) - (a.daysSinceLastVisit ?? 999);
    });

    this.logger.log(
      `Generated ${reminders.length} loyalty reminders for store ${storeId}`,
    );

    return reminders;
  }

  // -----------------------------------------------------------------------
  // Stock notifications — products below thresholds
  // -----------------------------------------------------------------------
  async getStockNotifications(
    storeId: string,
  ): Promise<StockNotification[]> {
    const products = await this.productsRepo.find({
      where: { storeId, isActive: true },
    });

    const notifications: StockNotification[] = [];

    for (const product of products) {
      let level: StockNotification['level'] | null = null;
      let message = '';

      if (product.stockQuantity <= 0) {
        level = 'out_of_stock';
        message = `${product.name} est en rupture de stock !`;
      } else if (product.stockQuantity <= product.stockCriticalThreshold) {
        level = 'critical';
        message = `${product.name}: stock critique (${product.stockQuantity} restant(s), seuil: ${product.stockCriticalThreshold})`;
      } else if (product.stockQuantity <= product.stockAlertThreshold) {
        level = 'alert';
        message = `${product.name}: stock bas (${product.stockQuantity} restant(s), seuil: ${product.stockAlertThreshold})`;
      }

      if (level) {
        notifications.push({
          productId: product.id,
          productName: product.name,
          ean: product.ean,
          stockQuantity: product.stockQuantity,
          alertThreshold: product.stockAlertThreshold,
          criticalThreshold: product.stockCriticalThreshold,
          level,
          message,
        });
      }
    }

    // Sort: out_of_stock > critical > alert
    const levelOrder = { out_of_stock: 0, critical: 1, alert: 2 };
    notifications.sort(
      (a, b) => levelOrder[a.level] - levelOrder[b.level],
    );

    return notifications;
  }

  // -----------------------------------------------------------------------
  // Full notification summary
  // -----------------------------------------------------------------------
  async getNotificationSummary(
    storeId: string,
    inactiveDays = 30,
  ): Promise<NotificationSummary> {
    const [loyaltyReminders, stockNotifications] = await Promise.all([
      this.getLoyaltyReminders(storeId, inactiveDays),
      this.getStockNotifications(storeId),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      loyaltyReminders,
      stockNotifications,
      stats: {
        totalInactiveCustomers: loyaltyReminders.length,
        totalStockAlerts: stockNotifications.filter(
          (n) => n.level === 'alert',
        ).length,
        totalCriticalStock: stockNotifications.filter(
          (n) => n.level === 'critical' || n.level === 'out_of_stock',
        ).length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Generate QR reminder message (for future SMS/email integration)
  // -----------------------------------------------------------------------
  async generateQrReminderMessage(
    customerId: string,
    storeId: string,
  ): Promise<{ message: string; qrCode: string }> {
    // Tenant-scoped: only find customer in this store
    const customer = await this.customersRepo.findOne({
      where: { id: customerId, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found in store ${storeId}`);
    }

    const hasFirstPurchase = customer.isFirstPurchase;
    let message: string;

    if (hasFirstPurchase) {
      message =
        `Bonjour ${customer.firstName} ! ` +
        `Votre code QR vous attend pour beneficier de -5% sur votre premier achat. ` +
        `Presentez-le en caisse !`;
    } else {
      message =
        `Bonjour ${customer.firstName} ! ` +
        `Vous avez ${customer.loyaltyPoints} points fidelite. ` +
        `Passez nous voir bientot !`;
    }

    // MVP: log message to console (future: send via SMS/email API)
    this.logger.log(
      `[QR REMINDER] To: ${customer.firstName} ${customer.lastName} ` +
        `(${customer.email || 'no email'}) — ${message}`,
    );

    return {
      message,
      qrCode: customer.qrCode,
    };
  }
}
