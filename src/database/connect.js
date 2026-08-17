import mongoose from 'mongoose';

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(' MongoDB connected successfully.');
  } catch (error) {
    console.error(' MongoDB connection failure:', error);
    process.exit(1);
  }
}