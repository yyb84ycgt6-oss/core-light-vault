import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remember, seedArchive } from '../src/archive/living-archive.js';

// Own file = own process = fresh database.
test('seeds are planted even if a symbol was sealed before the first archive visit', async () => {
  await remember('~0~', 'early symbol');
  assert.equal((await seedArchive()).length, 15);
  assert.equal((await seedArchive()).length, 15); // idempotent
});
