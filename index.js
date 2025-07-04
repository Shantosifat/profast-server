const express = require("express");
const cors = require("cors");
// const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("parcelDB");
    const parcelsCollection = database.collection("parcels");

    // get app parcels
    app.get("/parcels", async (req, res) => {
      const result = await parcelsCollection.find().toArray();
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;

      // Add tracking ID and order time
    //   parcel.trackingId = uuidv4();
      parcel.orderTime = new Date();

      try {
        const result = await parcelsCollection.insertOne(parcel);
        res.status(201).send({
          message: "Parcel created successfully",
        //   trackingId: parcel.trackingId,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).send({ error: "Failed to create parcel" });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
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
