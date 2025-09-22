//src/emailService.js
import { Resend } from 'resend';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

// تحميل ملف الترجمة من المسار الصحيح
const translationsPath = path.join(process.cwd(), 'translations.json');
const translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));

export const sendEmail = async (to, subject, html, text = null) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, '') // تحويل HTML إلى نص عادي إذا لم يتم توفير نص
    });

    if (error) {
      console.error('Error sending email:', error);
      return { success: false, error };
    }

    console.log('Email sent successfully:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Unexpected error:', error);
    return { success: false, error };
  }
};

// قوالب البريد الإلكتروني
// تم تعديل جميع القوالب لاستخدام النصوص من ملف الترجمة
export const emailTemplates = {
  welcome: (name, lang = 'ar') => {
    const t = translations[lang];
    return {
      subject: t.welcome_subject.replace('{name}', name),
      html: t.welcome_html.replace('{name}', name),
    };
  },
  bookingRequest: (passengerName, rideDetails, lang = 'ar') => {
    const t = translations[lang];
    const htmlWithData = t.booking_request_html
      .replace('{passengerName}', passengerName)
      .replace('{destination}', rideDetails.destination)
      .replace('{origin}', rideDetails.origin)
      .replace('{time}', new Date(rideDetails.time).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US'))
      .replace('{price}', rideDetails.price);

    return {
      subject: t.booking_request_subject.replace('{destination}', rideDetails.destination),
      html: htmlWithData,
    };
  },
  bookingConfirmation: (driverName, rideDetails, lang = 'ar') => {
    const t = translations[lang];
    const htmlWithData = t.booking_confirmation_html
      .replace('{driverName}', driverName)
      .replace('{destination}', rideDetails.destination)
      .replace('{origin}', rideDetails.origin)
      .replace('{time}', new Date(rideDetails.time).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US'))
      .replace('{price}', rideDetails.price);

    return {
      subject: t.booking_confirmation_subject.replace('{destination}', rideDetails.destination),
      html: htmlWithData,
    };
  },
  passwordReset: (name, resetToken, lang = 'ar') => {
    const t = translations[lang];
    return {
      subject: t.password_reset_subject,
      html: t.password_reset_html.replace('{name}', name).replace('{resetToken}', resetToken),
    };
  },
  verifyEmail: (name, verificationToken, lang = 'ar') => {
    const t = translations[lang];
    return {
      subject: t.verify_email_subject,
      html: t.verify_email_html.replace('{name}', name).replace('{verificationToken}', verificationToken),
    };
  }
};