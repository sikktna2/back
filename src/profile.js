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
// Get ANY user's public profile by ID
export const getPublicProfile = async (req, res) => {
  try {
    const { id: profileUserId } = req.params;
    const currentUserId = req.user.userId;

    // **** START: THE FIX ****
    // Use the correct variable 'profileUserId' here
    await calculateAndAssignBadges(profileUserId);
    // **** END: THE FIX ****

    const userProfile = await prisma.user.findUnique({
      where: { id: profileUserId },
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
          },
        },
        badges: { include: { badge: true } },
        feedbacksReceived: {
          orderBy: { createdAt: 'desc' },
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
          select: { feedbacksReceived: true },
        },
      },
    });

    if (!userProfile) {
      return res.status(404).json({ error: 'User not found' });
    }

    let friendshipStatus = 'NOT_FRIENDS';
    let friendshipId = null;

    if (currentUserId !== profileUserId) {
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: currentUserId, addresseeId: profileUserId },
            { requesterId: profileUserId, addresseeId: currentUserId },
          ],
        },
      });

      if (friendship) {
        friendshipId = friendship.id;
        if (friendship.status === 'ACCEPTED') {
          friendshipStatus = 'FRIENDS';
        } else if (friendship.status === 'PENDING') {
          friendshipStatus =
            friendship.requesterId === currentUserId
              ? 'PENDING_SENT'
              : 'PENDING_RECEIVED';
        }
      }
    }

    const response = {
      ...userProfile,
      totalFeedbacks: userProfile._count.feedbacksReceived,
      friendshipStatus,
      friendshipId,
    };
    delete response._count;

    res.json(response);
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: 'Failed to load user profile' });
  }
};

// Update user profile information
export const updateProfileImage = async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    // --- START: NEW ARCHIVING LOGIC ---
    await prisma.$transaction(async (tx) => {
      // 1. Find the user and their current ID images
      const user = await tx.user.findUnique({ where: { id: userId } });

      // 2. If old ID images exist, archive them
      if (user && user.idFrontImageUrl && user.idBackImageUrl) {
        await tx.idVerificationHistory.create({
          data: {
            userId: userId,
            idFrontImageUrl: user.idFrontImageUrl,
            idBackImageUrl: user.idBackImageUrl,
          },
        });
      }

      // 3. Update the user with the new profile image and reset verification status
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          profileImage: req.file.path,
          idVerificationStatus: 'PENDING', // Reset ID verification status
          profileImageLocked: true,        // Lock the new image
          // Nullify old image URLs to force re-upload
          idFrontImageUrl: null,
          idBackImageUrl: null,
        },
      });
      
      // Send back the updated user data in the response
      res.json({ message: 'Profile image updated, re-verification required.', user: updatedUser });
    });
    // --- END: NEW ARCHIVING LOGIC ---

  } catch (error) {
    console.error('Update profile image error:', error);
    res.status(500).json({ error: 'Failed to update profile image' });
  }
};

// In profile.js

// ADD THIS ENTIRE FUNCTION
export const updateProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  try {
    const userId = req.user.userId;
    const { name, birthDate, city, genderPreference, rideSearchWindowDays, driverLicenseExpiryDate, userType } = req.body;

const dataToUpdate = {
  name,
  birthDate: birthDate ? new Date(birthDate) : undefined,
  city,
  genderPreference,
  driverLicenseExpiryDate: driverLicenseExpiryDate ? new Date(driverLicenseExpiryDate) : undefined,
  userType, // <-- تمت إضافة هذا السطر
};

    // This removes any keys with an undefined value, so we don't accidentally nullify fields.
    Object.keys(dataToUpdate).forEach(key => dataToUpdate[key] === undefined && delete dataToUpdate[key]);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
    });

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// Create or update car information
export const updateCar = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const userId = req.user.userId;
    const { brand, model, year, color, plate, licensePhoto, licenseExpiryDate } = req.body;

    const carDataToUpdate = {};
    if (brand !== undefined) carDataToUpdate.brand = brand;
    if (model !== undefined) carDataToUpdate.model = model;
    if (year !== undefined) carDataToUpdate.year = parseInt(year);
    if (color !== undefined) carDataToUpdate.color = color;
    if (plate !== undefined) carDataToUpdate.plate = plate;
    if (licensePhoto !== undefined) carDataToUpdate.licensePhoto = licensePhoto;
    if (licenseExpiryDate !== undefined) carDataToUpdate.licenseExpiryDate = new Date(licenseExpiryDate);

    // --- START: NEW LOGIC ---
    // Get the existing car data to compare against
    const existingCar = await prisma.car.findUnique({ where: { userId } });

    // Check if any of the core, non-photo details are being changed
    const isCoreDataChanging = existingCar && (
         (carDataToUpdate.brand !== undefined && carDataToUpdate.brand !== existingCar.brand) ||
         (carDataToUpdate.model !== undefined && carDataToUpdate.model !== existingCar.model) ||
         (carDataToUpdate.year !== undefined && carDataToUpdate.year !== existingCar.year) ||
         (carDataToUpdate.color !== undefined && carDataToUpdate.color !== existingCar.color) ||
         (carDataToUpdate.plate !== undefined && carDataToUpdate.plate !== existingCar.plate)
    );
    
    // Only reset verification status if core data or license photo changes
    if (isCoreDataChanging || carDataToUpdate.licensePhoto) {
        carDataToUpdate.isVerified = false;
        carDataToUpdate.verificationStatus = 'PENDING';
    }
    // --- END: NEW LOGIC ---

    if (Object.keys(carDataToUpdate).length > 0) {
      const car = await prisma.car.upsert({
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

      res.json({ message: 'Car details updated.', car });
    } else {
      // If no data was sent, just return success without doing anything
      return res.status(200).json({ message: 'No car data provided for update.' });
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