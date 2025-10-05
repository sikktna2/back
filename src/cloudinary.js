//src/cloudinary.js
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary with credentials from .env file
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage for Multer
// This tells Multer to upload files directly to your Cloudinary account
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'rideshare_app', 
    // **** START: MODIFICATION ****
    // Add audio formats. 'm4a' is common for mobile, 'mp3' for web.
    allowed_formats: ['jpg', 'png', 'jpeg', 'mp3', 'm4a', 'aac', 'ogg', 'mp4'],
    resource_type: "auto", // Tell Cloudinary to detect if it's an image, video, or audio file
    // **** END: MODIFICATION ****
    transformation: [{ width: 1024, height: 1024, crop: 'limit' }],
  },
});

// Create the Multer instance with the configured storage
const upload = multer({ storage: storage });

export { cloudinary, upload };
