import 'reflect-metadata';
import { seedCatalog } from './seeds/seed-helpers';
import { StartupSeed } from './startup-seed';

jest.mock('./seeds/seed-helpers', () => ({ seedCatalog: jest.fn().mockResolvedValue(new Map()) }));

function setup(seedOnStart: boolean, pending = false) {
  const dataSource = {
    showMigrations: jest.fn().mockResolvedValue(pending),
    transaction: jest.fn((work: (manager: object) => Promise<unknown>) => work({ manager: true })),
  };
  const seed = new StartupSeed(dataSource as never, { seedOnStart } as never);
  return { seed, dataSource };
}

describe('startup seed', () => {
  beforeEach(() => jest.mocked(seedCatalog).mockClear());

  it('updates roles, permissions and templates when SEED_ON_START is true', async () => {
    const { seed, dataSource } = setup(true);
    await seed.onApplicationBootstrap();
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(seedCatalog).toHaveBeenCalledWith({ manager: true });
  });

  it('does nothing when SEED_ON_START is false', async () => {
    const { seed, dataSource } = setup(false);
    await seed.onApplicationBootstrap();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(seedCatalog).not.toHaveBeenCalled();
  });

  it('still starts when the migration check fails', async () => {
    const { seed, dataSource } = setup(false);
    dataSource.showMigrations.mockRejectedValue(new Error('no table'));
    await expect(seed.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
