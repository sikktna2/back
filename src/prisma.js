// prisma.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'test' ? [] : ['query', 'info', 'warn', 'error'],
  datasources: {
    db: {
      url: process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL,
    },
  },
});

// دالة للاتصال بقاعدة البيانات
export const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log('Connected to database successfully');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

// دالة لفصل الاتصال بقاعدة البيانات
export const disconnectDB = async () => {
  try {
    await prisma.$disconnect();
    console.log('Disconnected from database');
  } catch (error) {
    console.error('Error disconnecting from database:', error);
    process.exit(1);
  }
};

export { prisma };