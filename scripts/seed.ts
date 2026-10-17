import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { db } from '../apps/api/src/db.js';
import { passwordHash } from '../apps/api/src/auth.js';
if (process.env.ENABLE_DEMO_LOGIN !== 'true')
  throw Error('Demo seed requires ENABLE_DEMO_LOGIN=true.');
await db.user.upsert({
  where: { email: 'demo@careerflow.local' },
  create: {
    email: 'demo@careerflow.local',
    name: 'Alex Morgan',
    passwordHash: passwordHash(randomBytes(32).toString('hex')),
  },
  update: {},
});
console.log(
  'Fictional demo workspace is ready. No candidate profile has been approved on the user’s behalf.',
);
await db.$disconnect();
