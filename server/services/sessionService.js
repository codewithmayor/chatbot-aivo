const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN
});

async function getSession(userId) {
  const data = await redis.get(`session:${userId}`);
  return data ? JSON.parse(data) : { step: 0, answers: {}, fallbackCount:0, timer: null };
}

async function setSession(userId, session) {
  await redis.set(`session:${userId}`, JSON.stringify(session), { ex: 86400 }); //1 day expiry
}

async function clearSession(userId) {
  await redis.del(`session:${userId}`);
}

module.exports = { getSession, setSession, clearSession };
