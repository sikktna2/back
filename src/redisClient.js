// src/redisClient.js
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

// دالة للاتصال والتأكد من أن الاتصال جاهز
const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log('Connected to Redis successfully!');
  } catch (error) {
    console.error('Could not connect to Redis. Caching will be disabled.', error);
  }
};

// ابدأ الاتصال عند تشغيل التطبيق
connectRedis();

export default redisClient;