import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, ReadStream } from 'fs';
import { mkdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { storageConfig, StorageConfig } from '../../../config/configuration';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface ByteRange {
  start: number;
  end: number;
}

export interface FileStorage {
  put(key: string, content: Buffer): Promise<void>;
  read(key: string, range?: ByteRange): Promise<ReadStream>;
  remove(key: string): Promise<void>;
}

@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(@Inject(storageConfig.KEY) config: StorageConfig) {
    this.root = resolve(config.localDir);
  }

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async read(key: string, range?: ByteRange): Promise<ReadStream> {
    const path = this.path(key);
    await stat(path);
    return createReadStream(path, range);
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }
}
