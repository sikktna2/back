import request from 'supertest';
import { server } from '../server.js';
import redisClient from '../redisClient.js';
import { prisma } from '../prisma.js';

beforeEach(async () => {
    // Correct manual deletion order
    await prisma.notification.deleteMany().catch(() => {});
    await prisma.message.deleteMany().catch(() => {});
    await prisma.chatMember.deleteMany().catch(() => {});
    await prisma.chat.deleteMany().catch(() => {});
    await prisma.booking.deleteMany().catch(() => {});
    await prisma.rideComment.deleteMany().catch(() => {});
    await prisma.feedback.deleteMany().catch(() => {});
    await prisma.rideInterest.deleteMany().catch(() => {});
    await prisma.report.deleteMany().catch(() => {});
    await prisma.userBadge.deleteMany().catch(() => {});
    await prisma.badge.deleteMany().catch(() => {});
    await prisma.ride.deleteMany().catch(() => {});
    await prisma.carLicenseHistory.deleteMany().catch(() => {});
    await prisma.car.deleteMany().catch(() => {});
    await prisma.referral.deleteMany().catch(() => {});
    await prisma.userStats.deleteMany().catch(() => {});
    await prisma.adminLastVisit.deleteMany().catch(() => {});
    await prisma.promoCode.deleteMany().catch(() => {});
    await prisma.savedRoute.deleteMany().catch(() => {});
    await prisma.scheduledRide.deleteMany().catch(() => {});
    // Delete users last
    await prisma.user.deleteMany().catch(() => {});
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
});

describe('Authentication API', () => {
    it('should register a new user successfully with valid data', async () => {
        const response = await request(server)
            .post('/auth/register')
            .send({
                name: 'Test User',
                email: `test-${Date.now()}@example.com`,
                password: 'password123',
                phone: `+20100${Date.now()}`,
                gender: 'male',
                city: 'Cairo'
            });

        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('token');
    });

    it('should return 409 Conflict when registering with a duplicate email', async () => {
        await prisma.user.create({
            data: {
                name: 'Existing User',
                email: 'existing@example.com',
                password: 'password123',
                phone: '+201007654321',
            }
        });

        const response = await request(server)
            .post('/auth/register')
            .send({
                name: 'Another User',
                email: 'existing@example.com',
                password: 'anotherpassword',
                phone: '+201001112222',
                gender: 'male'
            });
            
        expect(response.statusCode).toBe(409);
    });
});