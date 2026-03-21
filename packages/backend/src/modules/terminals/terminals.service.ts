import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentTerminalEntity,
  TerminalStatus,
  TerminalDeviceType,
} from '../../database/entities/payment-terminal.entity';
import { StripeTerminalService } from '../stripe-terminal/stripe-terminal.service';

@Injectable()
export class TerminalsService {
  private readonly logger = new Logger(TerminalsService.name);

  constructor(
    @InjectRepository(PaymentTerminalEntity)
    private readonly terminalRepo: Repository<PaymentTerminalEntity>,
    private readonly stripeTerminalService: StripeTerminalService,
  ) {}

  /**
   * List all active terminals for a store.
   */
  async findAllByStore(storeId: string): Promise<PaymentTerminalEntity[]> {
    return this.terminalRepo.find({
      where: { storeId, isActive: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Find a single terminal by ID.
   */
  async findById(id: string): Promise<PaymentTerminalEntity> {
    const terminal = await this.terminalRepo.findOne({ where: { id } });
    if (!terminal) {
      throw new NotFoundException(`Terminal ${id} introuvable.`);
    }
    return terminal;
  }

  /**
   * Create a new terminal record.
   * If a registrationCode is provided and Stripe is configured,
   * register the physical reader with Stripe.
   */
  async create(
    storeId: string,
    data: {
      label: string;
      deviceType?: TerminalDeviceType;
      serialNumber?: string;
      registrationCode?: string;
    },
  ): Promise<PaymentTerminalEntity> {
    const terminal = this.terminalRepo.create({
      storeId,
      label: data.label,
      deviceType: data.deviceType || TerminalDeviceType.WISEPAD_3,
      serialNumber: data.serialNumber || null,
      registrationCode: data.registrationCode || null,
    });

    // If registration code provided, register with Stripe
    if (data.registrationCode) {
      try {
        const locationId = await this.ensureStripeLocation(storeId, data.label);
        terminal.stripeLocationId = locationId;

        const reader = await this.stripeTerminalService.registerReader(
          data.registrationCode,
          data.label,
          locationId,
        );

        terminal.stripeReaderId = reader.id;
        terminal.status = TerminalStatus.ONLINE;

        this.logger.log(
          `Stripe reader registered: ${reader.id} for store ${storeId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to register Stripe reader: ${err?.message}. Saving terminal without Stripe registration.`,
        );
        // Still save the terminal record, just without Stripe binding
      }
    }

    return this.terminalRepo.save(terminal);
  }

  /**
   * Update a terminal (label, isActive).
   */
  async update(
    id: string,
    data: { label?: string; isActive?: boolean },
  ): Promise<PaymentTerminalEntity> {
    const terminal = await this.findById(id);

    if (data.label !== undefined) terminal.label = data.label;
    if (data.isActive !== undefined) terminal.isActive = data.isActive;

    return this.terminalRepo.save(terminal);
  }

  /**
   * Update terminal heartbeat (status, battery, firmware, lastSeenAt).
   */
  async heartbeat(
    id: string,
    data: {
      status: TerminalStatus;
      batteryLevel?: number;
      firmwareVersion?: string;
    },
  ): Promise<PaymentTerminalEntity> {
    const terminal = await this.findById(id);

    terminal.status = data.status;
    terminal.lastSeenAt = new Date();
    if (data.batteryLevel !== undefined) terminal.batteryLevel = data.batteryLevel;
    if (data.firmwareVersion !== undefined) terminal.firmwareVersion = data.firmwareVersion;

    return this.terminalRepo.save(terminal);
  }

  /**
   * Ensure a Stripe Location exists for the store.
   * Re-uses an existing locationId if any terminal for this store already has one.
   */
  async ensureStripeLocation(
    storeId: string,
    storeName: string,
  ): Promise<string> {
    // Check if any terminal for this store already has a location
    const existing = await this.terminalRepo.findOne({
      where: { storeId },
      select: ['stripeLocationId'],
      order: { createdAt: 'ASC' },
    });

    if (existing?.stripeLocationId) {
      return existing.stripeLocationId;
    }

    // Create a new Stripe Location
    const location = await this.stripeTerminalService.createLocation(
      storeName,
      'FR',
    );

    this.logger.log(
      `Stripe Location created: ${location.id} for store ${storeId}`,
    );

    return location.id;
  }
}
