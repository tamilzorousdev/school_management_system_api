import { Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';
import { money } from '../../payroll/entities/money';

export const COPY_STATUSES = ['available', 'issued', 'lost', 'damaged', 'in_repair', 'withdrawn'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export const COPY_CONDITIONS = ['new', 'good', 'fair', 'poor'] as const;
export type CopyCondition = (typeof COPY_CONDITIONS)[number];

export const COPY_SOURCES = ['purchase', 'donation', 'other'] as const;
export type CopySource = (typeof COPY_SOURCES)[number];

@Entity('book_categories')
@Index('UQ_book_categories_school_code', ['school_id', 'code'], { unique: true, where: 'deleted_at IS NULL' })
export class BookCategory extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'boolean', default: false })
  is_reference: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;
}

@Entity('books')
@Index('UQ_books_school_isbn', ['school_id', 'isbn'], {
  unique: true,
  where: 'deleted_at IS NULL AND isbn IS NOT NULL',
})
export class Book extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subtitle: string | null;

  @Column({ type: 'varchar', length: 13, nullable: true })
  isbn: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  authors: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  publisher: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  edition: string | null;

  @Column({ type: 'smallint', nullable: true })
  published_year: number | null;

  @Column({ type: 'varchar', length: 30, default: 'English' })
  language: string;

  @Index()
  @Column({ type: 'int', nullable: true })
  category_id: number | null;

  @Column({ type: 'int', nullable: true })
  subject_id: number | null;

  @Column({ type: 'smallint', nullable: true })
  pages: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rack: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  shelf: string | null;

  @Column(money({ nullable: true, default: null }))
  price: number | null;

  @Column({ type: 'int', nullable: true })
  cover_file_id: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  keywords: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

@Entity('book_copies')
@Index('UQ_book_copies_school_accession', ['school_id', 'accession_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_book_copies_school_barcode', ['school_id', 'barcode'], { unique: true, where: 'deleted_at IS NULL' })
export class BookCopy extends SchoolScopedEntity {
  @Index()
  @Column({ type: 'int' })
  book_id: number;

  @Column({ type: 'varchar', length: 30 })
  accession_no: string;

  @Column({ type: 'varchar', length: 60 })
  barcode: string;

  @Column({ type: 'varchar', length: 12, default: 'available' })
  status: CopyStatus;

  @Column({ type: 'varchar', length: 8, default: 'good' })
  condition: CopyCondition;

  @Column({ type: 'varchar', length: 10, default: 'purchase' })
  source: CopySource;

  @Column({ type: 'varchar', length: 120, nullable: true })
  vendor: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  bill_no: string | null;

  @Column({ type: 'date', nullable: true })
  acquired_on: string | null;

  @Column(money({ nullable: true, default: null }))
  price: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;
}
