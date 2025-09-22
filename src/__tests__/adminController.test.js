import request from 'supertest';
import { app, server } from '../io';
import { prisma } from '../prisma';
import jwt from 'jsonwebtoken';

let adminToken, regularUserToken;
let regularUserId, pendingCarId;

beforeAll(async () => {
    // Clean database
    await prisma.car.deleteMany();
    await prisma.user.deleteMany();

    // 1. Create an Admin User
    const admin = await prisma.user.create({
        data: {
            name: 'Test Admin', email: 'admin.test@example.com', password: 'p',
            phone: '+20111ADMIN00', isVerified: true, role: 'ADMIN', isEmailVerified: true,
        }
    });
    adminToken = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);

    // 2. Create a Regular User with a PENDING verification status
    const regularUser = await prisma.user.create({
        data: {
            name: 'Pending User', email: 'pending.user@example.com', password: 'p',
            phone: '+20222PENDING0', isVerified: false, idVerificationStatus: 'PENDING', isEmailVerified: true,
        }
    });
    regularUserId = regularUser.id;
    regularUserToken = jwt.sign({ userId: regularUser.id }, process.env.JWT_SECRET);
    
    // 3. Create a Car for the regular user with PENDING status
    const car = await prisma.car.create({
        data: {
            brand: 'PendingCar', model: 'PC', year: 2023, color: 'Gray',
            plate: 'PEND | 00', userId: regularUser.id, verificationStatus: 'PENDING',
        }
    });
    pendingCarId = car.id;
});

afterAll((done) => {
    server.close(done);
});

describe('Admin API (/admin)', () => {

    it('should FORBID access to a regular user (403)', async () => {
        const response = await request(app)
            .get('/admin/users')
            .set('Authorization', `Bearer ${regularUserToken}`); // Using regular user's token
        
        expect(response.statusCode).toBe(403);
    });

    it('should ALLOW access to an admin user (200)', async () => {
        const response = await request(app)
            .get('/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(response.statusCode).toBe(200);
        // The response body should be an array of users
        expect(Array.isArray(response.body)).toBe(true);
    });

    it('should APPROVE a pending user verification (200)', async () => {
        const response = await request(app)
            .put(`/admin/users/${regularUserId}/verify`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'APPROVED' });

        expect(response.statusCode).toBe(200);

        // Verify in DB
        const userInDb = await prisma.user.findUnique({ where: { id: regularUserId } });
        expect(userInDb.isVerified).toBe(true);
        expect(userInDb.idVerificationStatus).toBe('APPROVED');
    });

    it('should REJECT a pending car verification (200)', async () => {
        const response = await request(app)
            .put(`/admin/cars/${pendingCarId}/verify`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'REJECTED' });

        expect(response.statusCode).toBe(200);
        
        // Verify in DB
        const carInDb = await prisma.car.findUnique({ where: { id: pendingCarId } });
        expect(carInDb.isVerified).toBe(false);
        expect(carInDb.verificationStatus).toBe('REJECTED');
    });

});