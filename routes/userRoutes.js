const express = require("express");
const { ObjectId } = require("mongodb");
const { client } = require("../db");

const router = express.Router();

// Helper to get the users collection
const usersCollection = () => client.db("drive-easy").collection("users");

// GET all users
router.get("/", async (req, res) => {
  try {
    const users = await usersCollection().find().toArray();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch users", error: error.message });
  }
});

// GET user by email — used by the frontend to resolve a signed-in user's role
router.get("/email/:email", async (req, res) => {
  try {
    const user = await usersCollection().findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user", error: error.message });
  }
});

// GET single user by id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await usersCollection().findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user", error: error.message });
  }
});

// POST create a new user
router.post("/", async (req, res) => {
  try {
    const { name, email, role, photoURL } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const existingUser = await usersCollection().findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const newUser = {
      name,
      email,
      role: role || "user",
      photoURL: photoURL || null,
      createdAt: new Date(),
    };

    const result = await usersCollection().insertOne(newUser);
    res.status(201).json({ insertedId: result.insertedId, ...newUser });
  } catch (error) {
    res.status(500).json({ message: "Failed to create user", error: error.message });
  }
});

// PATCH update a user by id
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const updates = req.body;
    // Prevent overwriting _id
    delete updates._id;

    // Safety net: never allow the platform's last admin to be demoted (avoids lockout).
    if (updates.role && updates.role !== "admin") {
      const target = await usersCollection().findOne({ _id: new ObjectId(id) });
      if (target?.role === "admin") {
        const adminCount = await usersCollection().countDocuments({ role: "admin" });
        if (adminCount <= 1) {
          return res.status(409).json({ message: "Cannot change the role of the last remaining admin" });
        }
      }
    }

    const result = await usersCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: "User updated successfully", modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});

// DELETE a user by id
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Safety net: never allow the platform's last admin to be deleted.
    const target = await usersCollection().findOne({ _id: new ObjectId(id) });
    if (target?.role === "admin") {
      const adminCount = await usersCollection().countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        return res.status(409).json({ message: "Cannot delete the last remaining admin" });
      }
    }

    const result = await usersCollection().deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete user", error: error.message });
  }
});

module.exports = router;
