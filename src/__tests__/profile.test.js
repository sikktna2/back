import request from 'supertest';
import { server } from '../server.js';
import redisClient from '../redisClient.js';
import { prisma } from '../prisma.js';
import jwt from 'jsonwebtoken';

let userToken, userId;

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
    
    const user = await prisma.user.create({
        data: {
            name: 'Profile User', email: 'profile@test.com', password: 'password',
            phone: '+201112223334', isVerified: true, isEmailVerified: true,
        }
    });
    userId = user.id;
    userToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
});

describe('Profile API (/profile)', () => {
    it('should successfully GET the user profile (200)', async () => {
        const response = await request(server)
            .get('/profile')
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(response.statusCode).toBe(200);
        expect(response.body.name).toBe('Profile User');
    });

    it('should successfully UPDATE the user profile (200)', async () => {
        const response = await request(server)
            .put('/profile')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ name: 'Updated Name', city: 'Alexandria' });

        expect(response.statusCode).toBe(200);
        expect(response.body.user.name).toBe('Updated Name');
    });

    it('should successfully CREATE a car for the user (200)', async () => {
        const response = await request(server)
            .put('/profile/car')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ brand: 'Kia', model: 'Cerato', year: 2022, color: 'White', plate: 'CAR | 99' });
        
        expect(response.statusCode).toBe(200);
        expect(response.body.car.brand).toBe('Kia');
        expect(response.body.car.isVerified).toBe(false);
    });
});