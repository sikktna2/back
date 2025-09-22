//src/profile.js
import { prisma } from './prisma.js';
import { calculateAndAssignBadges } from './badgeService.js';
import { validationResult } from 'express-validator';

// Get LOGGED IN user's full private profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    await calculateAndAssignBadges(userId);

    const userProfile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        gender: true,
        birthDate: true,
        city: true,
        profileImage: true,
        profileImageLocked: true,
        rating: true,
        completedRides: true,
        joinDate: true,
        genderPreference: true,
        isVerified: true,
        idVerificationStatus: true,
        isPremium: true,
        hasSeenOnboarding: true,
        preferredLanguage: true,
        darkMode: true,
        referralCode: true,
        premiumStartDate: true,
        premiumEndDate: true,
        autoRenew: true,
        nextFreeRideAt: true,
        driverLicenseExpiryDate: true, 
        car: true,
        badges: { include: { badge: true } },
        feedbacksReceived: {
          orderBy: { createdAt: 'desc' },
          include: {
            givenBy: { select: { id: true, name: true, profileImage: true } },
          },
        },
      },
    });

    if (!userProfile) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(userProfile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
};

// Get ANY user's public profile by ID
export const getPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    await calculateAndAssignBadges(id);

    const userProfile = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        city: true,
        profileImage: true,
        gender: true,
        rating: true,
        completedRides: true,
        joinDate: true,
        isVerified: true,
        isPremium: true,
        car: {
          select: {
            brand: true,
            model: true,
            year: true,
            color: true,
            isVerified: true,
          }
        },
        badges: { include: { badge: true } },
        feedbacksReceived: {
          orderBy: { [sortBy]: sortOrder },
          take: 3,
          include: {
            givenBy: {
              select: {
                id: true,
                name: true,
                profileImage: true,
              },
            },
          },
        },
        _count: {
          select: { feedbacksReceived: true }
        }
      },
    });

    if (!userProfile) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const response = {
        ...userProfile,
        totalFeedbacks: userProfile._count.feedbacksReceived
    };
    delete response._count;

    res.json(response);
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: 'Failed to load user profile' });
  }
};

// Update user profile information
export const updateProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const userId = req.user.userId;
    const { name, birthDate, city, profileImage, genderPreference, preferredLanguage, darkMode, driverLicenseExpiryDate, homeAddress, homeLat, homeLng, 
        workAddress, workLat, workLng  } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        birthDate: birthDate ? new Date(birthDate) : undefined,
        city,
        profileImage,
        genderPreference,
        preferredLanguage,
        darkMode,
        driverLicenseExpiryDate: driverLicenseExpiryDate ? new Date(driverLicenseExpiryDate) : undefined,
         homeAddress,
        homeLat: homeLat ? parseFloat(homeLat) : undefined,
        homeLng: homeLng ? parseFloat(homeLng) : undefined,
        workAddress,
        workLat: workLat ? parseFloat(workLat) : undefined,
        workLng: workLng ? parseFloat(workLng) : undefined,
      },
      select: {
        id: true, name: true, email: true, phone: true, gender: true,
        birthDate: true, city: true, profileImage: true, genderPreference: true,
        preferredLanguage: true, darkMode: true,
        updatedAt: true,
      },
    });

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// Create or update car information
// Create or update car information
export const updateCar = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const userId = req.user.userId;
    const { brand, model, year, color, plate, licensePhoto, licenseExpiryDate } = req.body;

    if (plate) {
      const plateRegex = /^([A-Za-z\u0600-\u06FF\s]{1,7})\s*\|\s*(\d{1,4})$/;
      if (!plate.match(plateRegex)) {
        return res.status(400).json({ error: 'Invalid plate number format. Expected format: "ABC | 123"' });
      }
    }

    const carDataToUpdate = {};
    if (brand !== undefined) carDataToUpdate.brand = brand;
    if (model !== undefined) carDataToUpdate.model = model;
    if (year !== undefined) carDataToUpdate.year = parseInt(year);
    if (color !== undefined) carDataToUpdate.color = color;
    if (plate !== undefined) carDataToUpdate.plate = plate;
    if (licensePhoto !== undefined) carDataToUpdate.licensePhoto = licensePhoto;
    if (licenseExpiryDate !== undefined) carDataToUpdate.licenseExpiryDate = new Date(licenseExpiryDate);

    if (Object.keys(carDataToUpdate).length > 0) {
      const car = await prisma.$transaction(async (tx) => {
        const existingCar = await tx.car.findUnique({ where: { userId } });
        
        // --- START: NEW ARCHIVING LOGIC ---
        // Check if core details (not the photo itself) are being changed
        const isCoreDataChanging = brand !== undefined || model !== undefined || year !== undefined || color !== undefined || plate !== undefined;
        
        // If core data is changing and there's an old license photo, archive it and clear the field
        if (existingCar && existingCar.licensePhoto && isCoreDataChanging && licensePhoto === undefined) {
             await tx.carLicenseHistory.create({
                data: {
                    carId: existingCar.id,
                    photoUrl: existingCar.licensePhoto,
                    status: 'PENDING', // Or you could add an 'ARCHIVED' status
                    notes: 'Archived due to car details update.'
                }
            });
            // Clear the current photo to force re-upload
            carDataToUpdate.licensePhoto = null;
        }
        // --- END: NEW ARCHIVING LOGIC ---

        // Always reset verification status on any update
        carDataToUpdate.isVerified = false;
        carDataToUpdate.verificationStatus = 'PENDING';

        const updatedCar = await tx.car.upsert({
          where: { userId },
          update: carDataToUpdate,
          create: {
            ...carDataToUpdate,
            userId,
            brand: carDataToUpdate.brand || '',
            model: carDataToUpdate.model || '',
            year: carDataToUpdate.year || 0,
            color: carDataToUpdate.color || '',
            plate: carDataToUpdate.plate || ' | ',
          },
        });

        if (licensePhoto) {
            await tx.carLicenseHistory.create({
                data: {
                    carId: updatedCar.id,
                    photoUrl: licensePhoto,
                    status: 'PENDING'
                }
            });
        }
        
        return updatedCar;
      });

      res.json({ message: 'Car details updated. Verification is pending.', car });

    } else {
      return res.status(400).json({ error: 'No valid car fields provided for update' });
    }
  } catch (error) {
    console.error('Update car error:', error);
    res.status(500).json({ error: 'Failed to update car' });
  }
};

export const getCar = async (req, res) => {
  try {
    const userId = req.user.userId;
    const car = await prisma.car.findUnique({ where: { userId } });
    if (!car) {
      return res.status(404).json({ error: 'No car found for this user' });
    }
    res.json(car);
  } catch (error) {
    console.error('Get car error:', error);
    res.status(500).json({ error: 'Failed to get car' });
  }
};

export const getStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { completedRides: true, rating: true, joinDate: true }
    });
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    const stats = {
        completedRides: user.completedRides,
        averageRating: user.rating,
        memberSince: user.joinDate,
    };
    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};

// Subscribe to premium
export const subscribePremium = async (req, res) => {
  try {
    const userId = req.user.userId;
    // *** MODIFICATION: Prepared for Google Pay integration ***
    const { purchaseToken, autoRenew } = req.body; 

    // Placeholder for payment gateway verification logic
    // In a real app, you would verify the 'purchaseToken' with Google's API
    if (!purchaseToken) {
        return res.status(400).json({ error: 'Purchase token is required.' });
    }
    const isTokenValid = true; // Assume token is valid for now
    
    if (!isTokenValid) {
        return res.status(400).json({ error: 'Invalid purchase token.' });
    }
    
    // --- OLD LOGIC REMOVED ---
    // const user = await prisma.user.findUnique({ where: { id: userId }, select: { balance: true } });
    // if (!user) return res.status(404).json({ error: 'User not found' });
    // const premiumCost = 99.99;
    // if (user.balance < premiumCost) return res.status(400).json({ error: 'Insufficient balance' });
    
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        // --- OLD LOGIC REMOVED ---
        // balance: { decrement: premiumCost },
        isPremium: true,
        premiumStartDate: startDate,
        premiumEndDate: endDate,
        autoRenew: autoRenew || false,
      },
    });

    res.json({ message: 'Premium subscription activated successfully', user: updatedUser });
  } catch (error) {
    console.error('Premium subscription error:', error);
    res.status(500).json({ error: 'Failed to subscribe to premium' });
  }
};

// Cancel auto-renewal
export const cancelAutoRenew = async (req, res) => {
  try {
    const userId = req.user.userId;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { autoRenew: false },
    });

    res.json({ message: 'Auto-renewal cancelled successfully', user: updatedUser });
  } catch (error) {
    console.error('Cancel auto-renewal error:', error);
    res.status(500).json({ error: 'Failed to cancel auto-renewal' });
  }
};

export const getUserFeedbacks = async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = 3 + (page - 2) * limit;

    const feedbacks = await prisma.feedback.findMany({
      where: { receivedById: id },
      orderBy: { createdAt: 'desc' },
      skip: skip,
      take: limit,
      include: {
        givenBy: {
          select: { id: true, name: true, profileImage: true },
        },
      },
    });

    const totalFeedbacks = await prisma.feedback.count({
        where: { receivedById: id },
    });

    res.json({
        feedbacks,
        totalPages: Math.ceil(totalFeedbacks / limit),
        currentPage: page,
    });

  } catch (error) {
    console.error('Get user feedbacks error:', error);
    res.status(500).json({ error: 'Failed to load feedbacks' });
  }
};

// Function to reset the free ride timer
export const resetFreeRideTimer = async (req, res) => {
    try {
        const userId = req.user.userId;
        const nextFreeDate = new Date();
        nextFreeDate.setHours(nextFreeDate.getHours() + 12);

        await prisma.user.update({
            where: { id: userId },
            data: {
                nextFreeRideAt: nextFreeDate,
            },
        });

        res.status(200).json({ message: 'Free ride timer has been reset.' });

    } catch (error) {
        console.error('Reset free ride timer error:', error);
        res.status(500).json({ error: 'Failed to reset free ride timer.' });
    }
};