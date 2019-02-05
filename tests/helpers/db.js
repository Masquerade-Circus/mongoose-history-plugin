let MongooseHistoryPlugin = require('../../index');

let getRandomName = () => (0 | (Math.random() * 9e6)).toString(36);

module.exports = (mongoose) => {
  let dbname = getRandomName();
  let connectionString = `mongodb://localhost:27017/${dbname}`;
  let connectionOptions = { useNewUrlParser: true };
  let db;

  return {
    dbname,
    MongooseHistoryPlugin,
    connectionString,
    connectionOptions,
    getRandomName,
    async start({ log }) {
      await mongoose.connect(connectionString, connectionOptions, function (error) {
        if (error) {
          throw error;
        }
        log(`Mongoose listening on port 27017 to database "${dbname}"`);
      });
    },
    async close() {
      await mongoose.connection.db.dropDatabase();
      await mongoose.connection.close();
    },
    async dropCollection(name) {
      try {
        await mongoose.connection.db.dropCollection(name);
      } catch (error) {
        if (error.message !== 'ns not found') {
          throw error;
        }
      }
    },
    async dropCollections() {
      let collections = Object.keys(mongoose.connection.collections);

      for (let name of collections) {
        try {
          await mongoose.connection.collections[name].drop();
        } catch (error) {
          if (error.message !== 'ns not found') {
            throw error;
          }
        }
      }
    }
  };
};
