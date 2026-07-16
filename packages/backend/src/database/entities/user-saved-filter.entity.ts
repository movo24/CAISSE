import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * Vue/filtre enregistrable par employé (P-D / M-G). `config` = snapshot opaque
 * de la vue (colonnes visibles, tri, filtres), non interprété côté serveur.
 */
@Entity('user_saved_filters')
@Index(['employeeId', 'page'])
export class UserSavedFilterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ type: 'varchar', length: 30 })
  page: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
