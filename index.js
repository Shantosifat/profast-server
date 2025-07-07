const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_Key);

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();

    const database = client.db("parcelDB");
    const usersCollection = database.collection("users");
    const parcelsCollection = database.collection("parcels");
    const paymentsCollection = database.collection("payments");
    const trackingCollection = database.collection("tracking");

    // users

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const user = req.body;

      const userExist = await usersCollection.findOne({ email });

      if (userExist) {
        // ✅ Update last login timestamp
        await usersCollection.updateOne(
          { email },
          {
            $set: {
              last_log_in: new Date(),
            },
          }
        );

        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }

      // ✅ Set lastLogin for new user too (optional but useful)
      user.last_log_in = new Date();

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // GET /parcels - fetch all parcels or filter by email query param
    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const cursor = parcelsCollection.find(query).sort({ orderTime: -1 });
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ error: "Failed to fetch parcels" });
      }
    });

    // GET /parcels/:id - fetch a single parcel by id
    app.get("/parcels/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ error: "Failed to fetch parcel" });
      }
    });

    // POST /parcels - create a new parcel
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;

      // Add orderTime field
      parcel.orderTime = new Date();

      try {
        const result = await parcelsCollection.insertOne(parcel);
        res.status(201).send({
          message: "Parcel created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).send({ error: "Failed to create parcel" });
      }
    });

    // FOR TRACKING

    app.post("/tracking", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by = "",
      } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        time: new Date().toISOString(),
        message,
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ result, success: true, insertedId: result.insertedId });
    });

    // FOR PAYMENT

    // Admin/User: Get payment history
    app.get("/payments", async (req, res) => {
      try {
        const userEmail = req.query.email;

        const filter = userEmail ? { email: userEmail } : {};
        // latest hisotry first
        const options = { sort: { paid_at: -1 } };

        const payments = await paymentsCollection
          .find(filter, options)
          // .sort({ date: -1 }) // Newest first
          .toArray();

        res.send(payments);
      } catch (error) {
        res.status(500).send({ error: "Failed to retrieve payments." });
      }
    });

    // POST /create-payment-intent - for Stripe payments (assuming stripe initialized)
    app.post("/create-payment-intent", async (req, res) => {
      const amountinCents = req.body.amountinCents; // amount in cents

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountinCents, // e.g. 500 for $5.00
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // After successful payment
    app.post("/payments", async (req, res) => {
      const {
        // paymentIntentId,
        paymentMethod,
        transactionId,
        parcelId,
        email,
        amount,
        // userName,
      } = req.body;

      try {
        // 1. Update parcel
        const parcelUpdate = await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: "paid",
              transactionId: transactionId,
            },
          }
        );
        if (parcelUpdate.modifiedCount === 0) {
          return res
            .status(400)
            .send({ message: "Parcel is not found or already paid" });
        }

        // 2. Add payment history
        const paymentDoc = {
          email,
          // userName,
          amount,
          // paymentIntentId,
          transactionId,
          parcelId,
          paymentMethod,
          status: "paid",
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: "Payment recorded successfully.",
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to record payment." });
      }
    });

    // DELETE /parcels/:id - delete a parcel by id
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await parcelsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send({
          result,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ error: "Failed to delete parcel" });
      }
    });

    // Ping DB to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Do not close client, keep server running
    // await client.close();
  }
}

run().catch(console.dir);

// Basic route
app.get("/", (req, res) => {
  res.send("Delivery App Server is running 🚀");
});

app.listen(port, () => {
  console.log(`Server listening at ${port}`);
});
