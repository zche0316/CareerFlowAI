import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../apps/api/src/db.js';
import { approveProfile } from '../apps/api/src/domain.js';

vi.mock('../apps/api/src/db.js', () => ({ db: { $transaction: vi.fn() } }));

function transaction(claimed: number, versionChanged = 1) {
  return {
    profileDraft: {
      // Reproduce an old DRAFT snapshot even when cancellation wins before the claim.
      findFirst: vi.fn().mockResolvedValue({
        id: 'draft',
        userId: 'owner',
        status: 'DRAFT',
        baseVersion: 1,
        data: {},
        facts: [],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      update: vi.fn(),
    },
    user: { updateMany: vi.fn().mockResolvedValue({ count: versionChanged }) },
    profile: { create: vi.fn().mockResolvedValue({ id: 'approved', version: 2 }) },
    mission: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

beforeEach(() => {
  vi.mocked(db.$transaction).mockReset();
});

describe('UC1 approval/discard contention', () => {
  it('does not approve or increment a version after cancellation wins the draft transition', async () => {
    const tx = transaction(0);
    vi.mocked(db.$transaction).mockImplementation(async (run: any) => run(tx));
    await expect(approveProfile('owner', 'draft')).rejects.toMatchObject({
      code: 'DRAFT_USED',
      status: 409,
    });
    expect(tx.profileDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft', userId: 'owner', status: 'DRAFT' },
      data: { status: 'APPROVED' },
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.profile.create).not.toHaveBeenCalled();
  });

  it('claims the draft before advancing the user version and storing a new approved profile', async () => {
    const tx = transaction(1);
    vi.mocked(db.$transaction).mockImplementation(async (run: any) => run(tx));
    await expect(approveProfile('owner', 'draft')).resolves.toEqual({ id: 'approved', version: 2 });
    expect(tx.profileDraft.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.profileDraft.update).not.toHaveBeenCalled();
  });
});
