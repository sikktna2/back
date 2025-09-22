import request from 'supertest';
import { app, server } from '../io';
import { prisma } from '../prisma';
import jwt from 'jsonwebtoken';

let userToken, userId;

beforeAll(async () => {
    // Clean
    await prisma.car.deleteMany();
    await prisma.user.deleteMany();

    // Create a user
    const user = await prisma.user.create({
        data: {
            name: 'Profile User', email: 'profile@test.com', password: 'password',
            phone: '+201112223334', isVerified: true, isEmailVerified: true,
        }
    });
    userId = user.id;
    userToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
});

afterAll((done) => {
    server.close(done);
});

describe('Profile API (/profile)', () => {

    it('should successfully GET the user profile (200)', async () => {
        const response = await request(app)
            .get('/profile')
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(response.statusCode).toBe(200);
        expect(response.body.name).toBe('Profile User');
        expect(response.body.email).toBe('profile@test.com');
    });

    it('should successfully UPDATE the user profile (200)', async () => {
        const response = await request(app)
            .put('/profile')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                name: 'Updated Name',
                city: 'Alexandria'
            });

        expect(response.statusCode).toBe(200);
        expect(response.body.user.name).toBe('Updated Name');

        // Verify in DB
        const userInDb = await prisma.user.findUnique({ where: { id: userId } });
        expect(userInDb.name).toBe('Updated Name');
        expect(userInDb.city).toBe('Alexandria');
    });

    it('should successfully CREATE a car for the user (200)', async () => {
        const response = await request(app)
            .put('/profile/car')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                brand: 'Kia', model: 'Cerato', year: 2022,
                color: 'White', plate: 'CAR | 99'
            });
        
        expect(response.statusCode).toBe(200);
        expect(response.body.car.brand).toBe('Kia');
        expect(response.body.message).toContain('Verification is pending');

        // Verify in DB
        const carInDb = await prisma.car.findUnique({ where: { userId: userId } });
        expect(carInDb).not.toBeNull();
        expect(carInDb.isVerified).toBe(false); // Should be unverified initially
        expect(carInDb.verificationStatus).toBe('PENDING');
    });

    it('should UPDATE car details and RESET verification status (200)', async () => {
        // First, let's manually verify the car for the test
        await prisma.car.update({
            where: { userId: userId },
            data: { isVerified: true, verificationStatus: 'APPROVED' }
        });
        
        // Now, update the car details
        const response = await request(app)
            .put('/profile/car')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ color: 'Black' }); // Just changing one detail

        expect(response.statusCode).toBe(200);
        expect(response.body.car.color).toBe('Black');

        // Verify in DB that verification is reset
        const carInDb = await prisma.car.findUnique({ where: { userId: userId } });
        expect(carInDb.isVerified).toBe(false);
        expect(carInDb.verificationStatus).toBe('PENDING');
    });

});