//src/auth.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from './prisma.js';
import { sendEmail, emailTemplates } from './emailService.js'; 
import { OAuth2Client } from 'google-auth-library'; // <-- إضافة في بداية الملف
import axios from 'axios';

const JWT_SECRET = process.env.JWT_SECRET;
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

async function findOrCreateUser(userData) {
  const { email, name, profileImage, gender } = userData;

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // إذا لم يكن المستخدم موجودًا، قم بإنشاء حساب جديد
    user = await prisma.user.create({
      data: {
        name,
        email,
        phone: `social_${Date.now()}`, // رقم هاتف مؤقت وفريد
        password: 'social_login_placeholder', // كلمة مرور مؤقتة
        profileImage: profileImage || (gender === 'male' ? 'assets/images/male.jpg' : 'assets/images/female.jpg'),
        gender: gender,
        isEmailVerified: true, // البريد الإلكتروني موثوق به من جوجل/فيسبوك
        referralCode: generateReferralCode(),
      },
    });
  }

  // إنشاء توكن JWT للمستخدم وإعادته
  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      hasSeenOnboarding: user.hasSeenOnboarding,
    },
  };
}

// دالة تسجيل الدخول بجوجل
export const googleSignIn = async (req, res) => {
  const { token } = req.body;
  try {
    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { name, email, picture } = payload;
    
    const { token: jwtToken, user } = await findOrCreateUser({
      email,
      name,
      profileImage: picture,
    });

    res.status(200).json({ token: jwtToken, user });
  } catch (error) {
    console.error("Google sign-in error:", error);
    res.status(400).json({ error: "Invalid Google token." });
  }
};

// دالة تسجيل الدخول بفيسبوك
export const facebookSignIn = async (req, res) => {
  const { token } = req.body;
  try {
    // التحقق من التوكن وجلب بيانات المستخدم من فيسبوك
    const { data } = await axios.get(`https://graph.facebook.com/me?fields=id,name,email,picture,gender&access_token=${token}`);
    
    if (!data.email) {
      return res.status(400).json({ error: "Facebook account has no associated email." });
    }
    
    const { token: jwtToken, user } = await findOrCreateUser({
      email: data.email,
      name: data.name,
      profileImage: data.picture?.data?.url,
      gender: data.gender,
    });

    res.status(200).json({ token: jwtToken, user });
  } catch (error) {
    console.error("Facebook sign-in error:", error.response?.data || error.message);
    res.status(400).json({ error: "Invalid Facebook token." });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password, phone, gender, birthDate, city, referralCode } = req.body;

    if (!name || !email || !password || !phone || !gender) {
      return res.status(400).json({ error: 'Name, email, password, phone, and gender are required' });
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existingUser) {
      const field = existingUser.email === email ? 'Email' : 'Phone number';
      return res.status(409).json({ error: `${field} is already in use` });
    }

    const newReferralCode = generateReferralCode();
    let referrer = null; 
    if (referralCode) {
      referrer = await prisma.user.findUnique({
        where: { referralCode },
      });

      if (!referrer) {
        return res.status(400).json({ error: 'Invalid referral code.' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Default profile image based on gender
    const defaultProfileImage = gender === 'male' ? 'assets/images/male.jpg' : 'assets/images/female.jpg';

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone,
        gender,
        city,
        profileImage: defaultProfileImage,
        referralCode: newReferralCode,
        birthDate: birthDate ? new Date(birthDate) : null,
        // *** REMOVED: Initial balance assignment ***
        // balance: 149.99, 
        nextFreeRideAt: new Date(),
      },
    });

    if (referrer) {
      // *** REMOVED: Referral bonus logic ***
      // await prisma.user.update({
      //   where: { id: referrer.id },
      //   data: { balance: { increment: 30 } }, 
      // });

      await prisma.referral.create({
        data: {
          code: referralCode,
          referrerId: referrer.id,
          refereeId: newUser.id,
          bonusGiven: true, // We can keep this for tracking purposes
        },
      });
    }

    const verificationToken = crypto.randomBytes(3).toString('hex').toUpperCase();
    const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.user.update({
        where: { id: newUser.id },
        data: {
            emailVerificationToken: hashedToken,
            emailVerificationExpires: verificationExpires,
        },
    });

    const verificationEmail = emailTemplates.verifyEmail(newUser.name, verificationToken);
    await sendEmail(newUser.email, verificationEmail.subject, verificationEmail.html);
        
    const welcomeEmail = emailTemplates.welcome(newUser.name);
    await sendEmail(newUser.email, welcomeEmail.subject, welcomeEmail.html);

    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        gender: newUser.gender,
      },
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'P2002') {
         const target = error.meta?.target || [];
         if (target.includes('email')) {
             return res.status(409).json({ error: 'Email is already in use.' });
         }
         if (target.includes('phone')) {
             return res.status(409).json({ error: 'Phone number is already in use.' });
         }
         return res.status(409).json({ error: 'A user with these details already exists.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req, res) => {
  console.log('--- LOGIN ATTEMPT RECEIVED ---');
  console.log('Request Body:', req.body);
  console.log('Request Headers:', req.headers['content-type']);
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // --- START: ADMIN PANEL MODIFICATION ---
    // Check if the user is an admin for the admin panel login
    // We can differentiate requests by adding a body parameter, e.g., { ..., source: 'admin' }
    // For now, we allow admins to log in to both app and panel.
    if (req.body.source === 'admin' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You do not have permission to access the admin panel.' });
    }
    // --- END: ADMIN PANEL MODIFICATION ---

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        hasSeenOnboarding: user.hasSeenOnboarding,
        preferredLanguage: user.preferredLanguage,
        darkMode: user.darkMode,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        
        if (!user) {
            return res.status(200).json({ message: 'If a user with this email exists, a reset token will be sent.' });
        }

        const resetToken = crypto.randomBytes(3).toString('hex').toUpperCase(); 
        const passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); 

        await prisma.user.update({
            where: { email },
            data: { passwordResetToken, passwordResetExpires },
        });

        const resetEmail = emailTemplates.passwordReset(user.name, resetToken);
        await sendEmail(user.email, resetEmail.subject, resetEmail.html);

        res.status(200).json({ message: 'Token sent to email!' });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'An error occurred while trying to send the reset email.' });
    }
};

export const resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body; 

        if (!token || !password) {
            return res.status(400).json({ error: 'Token and new password are required.' });
        }

        const hashedToken = crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');

        const user = await prisma.user.findFirst({
            where: {
                passwordResetToken: hashedToken,
                passwordResetExpires: { gt: new Date() },
            },
        });

        if (!user) {
            return res.status(400).json({ error: 'Token is invalid or has expired.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                passwordResetToken: null,
                passwordResetExpires: null,
            },
        });

        res.status(200).json({ message: 'Password has been reset successfully.' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password.' });
    }
};

// In src/auth.js -> add this new export function
export const verifyEmail = async (req, res) => {
    try {
        const { token, email } = req.body;
        if (!token || !email) {
            return res.status(400).json({ error: 'Token and email are required.' });
        }

        const hashedToken = crypto.createHash('sha256').update(token.toUpperCase()).digest('hex');

        const user = await prisma.user.findFirst({
            where: {
                email: email,
                emailVerificationToken: hashedToken,
                emailVerificationExpires: { gt: new Date() },
            },
        });

        if (!user) {
            return res.status(400).json({ error: 'Token is invalid or has expired.' });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                isEmailVerified: true,
                emailVerificationToken: null,
                emailVerificationExpires: null,
            },
        });

        res.status(200).json({ message: 'Email verified successfully.' });

    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ error: 'Failed to verify email.' });
    }
};

// In src/auth.js -> add this new export function
export const resendVerification = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (user.isEmailVerified) {
            return res.status(400).json({ error: 'Email is already verified.' });
        }

        const verificationToken = crypto.randomBytes(3).toString('hex').toUpperCase();
        const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerificationToken: hashedToken,
                emailVerificationExpires: verificationExpires,
            },
        });

        const verificationEmail = emailTemplates.verifyEmail(user.name, verificationToken);
        await sendEmail(user.email, verificationEmail.subject, verificationEmail.html);

        res.status(200).json({ message: 'Verification email sent.' });

    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to resend verification email.' });
    }
};

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token is required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; 
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireAdmin = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (user && user.role === 'ADMIN') {
      next();
    } else {
      return res.status(403).json({ error: 'Admin access required' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Authorization failed' });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
        return res.status(400).json({ error: 'Incorrect current password' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedNewPassword },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
};

export const logout = async (req, res) => {
  try {
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
};

export const updateUserPreferences = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { hasSeenOnboarding, preferredLanguage, darkMode, rideSearchWindowDays } = req.body;

    const dataToUpdate = {
        hasSeenOnboarding,
        preferredLanguage,
        darkMode,
        rideSearchWindowDays: rideSearchWindowDays ? parseInt(rideSearchWindowDays) : undefined,
    };
    
    // This removes any keys with an undefined value, so we don't accidentally nullify fields.
    Object.keys(dataToUpdate).forEach(key => dataToUpdate[key] === undefined && delete dataToUpdate[key]);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
    });

    res.json({ message: 'Preferences updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
};