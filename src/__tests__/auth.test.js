import request from 'supertest';
import { app, server, userSockets } from '../io'; // We need the exported app from your io.js
import { prisma } from '../prisma';

// This function will close the server after all tests are done
afterAll((done) => {
    server.close(done);
});

describe('Authentication API', () => {
    // Before each test, we clean the database to ensure a fresh start
    beforeEach(async () => {
        await prisma.referral.deleteMany();
        await prisma.user.deleteMany();
    });

    // Test Case 1: Successful User Registration
    it('should register a new user successfully with valid data', async () => {
        const response = await request(app)
            .post('/auth/register')
            .send({
                name: 'Test User',
                email: 'test@example.com',
                password: 'password123',
                phone: '+201001234567',
                gender: 'male',
                city: 'Cairo'
            });

        // Assertions: Check if the response is what we expect
        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('token');
        expect(response.body.user).toHaveProperty('id');
        expect(response.body.user.name).toBe('Test User');

        // Check the database to confirm user creation
        const userInDb = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
        expect(userInDb).not.toBeNull();
        expect(userInDb.name).toBe('Test User');
    });

    // Test Case 2: Registration with a duplicate email
    it('should return 409 Conflict when registering with a duplicate email', async () => {
        // First, create a user
        await request(app)
            .post('/auth/register')
            .send({
                name: 'Existing User',
                email: 'existing@example.com',
                password: 'password123',
                phone: '+201007654321',
                gender: 'female'
            });

        // Then, try to register again with the same email
        const response = await request(app)
            .post('/auth/register')
            .send({
                name: 'Another User',
                email: 'existing@example.com',
                password: 'anotherpassword',
                phone: '+201001112222',
                gender: 'male'
            });
            
        // Assertions: Check for the conflict error
        expect(response.statusCode).toBe(409);
        expect(response.body.error).toContain('Email is already in use');
    });
});