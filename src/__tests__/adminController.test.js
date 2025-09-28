import request from 'supertest';
import { server } from '../server.js';
import redisClient from '../redisClient.js';
import { prisma } from '../prisma.js';
import jwt from 'jsonwebtoken';

let adminToken, regularUserToken;
let regularUserId;

beforeEach(async () => {
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

    const admin = await prisma.user.create({
        data: { name: 'Test Admin', email: 'admin.test@example.com', password: 'p', phone: `+2011${Date.now()}`, role: 'ADMIN' }
    });
    adminToken = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
    
    const regularUser = await prisma.user.create({
        data: { name: 'Pending User', email: 'pending.user@example.com', password: 'p', phone: `+2022${Date.now()}`, idVerificationStatus: 'PENDING' }
    });
    regularUserId = regularUser.id;
    regularUserToken = jwt.sign({ userId: regularUser.id }, process.env.JWT_SECRET);
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
});

describe('Admin API (/admin)', () => {
    it('should FORBID access to a regular user (403)', async () => {
        const response = await request(server)
            .get('/admin/users')
            .set('Authorization', `Bearer ${regularUserToken}`);
        
        expect(response.statusCode).toBe(403);
    });

    it('should ALLOW access to an admin user (200)', async () => {
        const response = await request(server)
            .get('/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    it('should APPROVE a pending user verification (200)', async () => {
        const response = await request(server)
            .put(`/admin/users/${regularUserId}/verify`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'APPROVED' });

        expect(response.statusCode).toBe(200);
        const userInDb = await prisma.user.findUnique({ where: { id: regularUserId } });
        expect(userInDb.idVerificationStatus).toBe('APPROVED');
    });
});