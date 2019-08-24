import test from 'ava';
import expect from 'expect';
import DbHelper from './helpers/db';
import mongoose from 'mongoose';
import util from 'util';

const { start, close, MongooseHistoryPlugin } = DbHelper(mongoose);

test.before('Start server', start);
test.after.always('Close server', close);

// Default options
const options = {
  mongoose: mongoose, // A mongoose instance,
  userCollection: 'users', // Colletcion to ref when you pass an user id
  accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
  userFieldName: 'user', // Name of the property for the user
  accountFieldName: 'account', // Name of the property of the account if any
  timestampFieldName: 'timestamp', // Name of the property of the timestamp
  methodFieldName: 'method', // Name of the property of the method
  ignore: [], // List of fields to ignore when compare changes
  noDiffSave: false, // If true save event even if there are no changes
  noDiffSaveOnMethods: ['delete'], // If a method is in this list, it saves history even if there is no diff.
  noEventSave: true, // If false save only when __history property is passed
  modelName: '__histories', // Name of the collection for the histories

  // If true save only the _id of the populated fields
  // If false save the whole object of the populated fields
  // If false and a populated field property changes it triggers a new history
  // You need to populate the field after a change is made on the original document or it will not catch the differences
  ignorePopulatedFields: true
};

const HistoryPlugin = MongooseHistoryPlugin(options);

const CompiledSchema = mongoose.Schema({ name: 'string', size: 'string' });
CompiledSchema.plugin(HistoryPlugin);

const embeddedOptionDefaults = {
  embeddedDocument: true,
  embeddedModelName: 'EmbeddedCollection',
  modelName: '__embedded_histories'
};
const embeddedOptions = Object.assign({}, options, embeddedOptionDefaults);
const EmbeddedSchema = mongoose.Schema({ name: 'string', size: 'string' });
EmbeddedSchema.plugin(MongooseHistoryPlugin(embeddedOptions));

test('should add the plugin to a schema', async (t) => {
  // Create a new schema
  let Schema = mongoose.Schema({ name: 'string', size: 'string' });

  // Initial schema must have no plugins
  expect(Schema.plugins).toEqual([]);

  // Add the mongoose history plguin
  Schema.plugin(HistoryPlugin);

  // Expect the plugin to be added to the schema
  expect(Schema.plugins).toEqual([
    expect.objectContaining({
      fn: expect.any(Function)
    })
  ]);
});

test('should test methods added to the schema', async (t) => {
  let Schema = mongoose.Schema({ name: 'string', size: 'string' });
  Schema.plugin(HistoryPlugin);

  expect(Schema.methods).toEqual({
    getDiffs: expect.any(Function),
    getDiff: expect.any(Function),
    getVersion: expect.any(Function),
    getVersions: expect.any(Function),
    compareVersions: expect.any(Function)
  });
});

test('should test methods added to the model', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  expect(typeof small.getDiffs).toEqual('function');
  expect(typeof small.getDiff).toEqual('function');
  expect(typeof small.getVersion).toEqual('function');
  expect(typeof small.getVersions).toEqual('function');
  expect(typeof small.compareVersions).toEqual('function');
});

test('should create history when save', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  await small.save();
  let diffs = await small.getDiffs();

  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank',
      collectionId: small._id,
      diff: { _id: [String(small._id)], size: ['small'] },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should create history when save a change', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  await small.save();
  small.size = 'large';
  await small.save();
  let diffs = await small.getDiffs();

  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '1.0.0',
      collectionName: 'tank',
      collectionId: small._id,
      diff: { size: ['small', 'large'] },
      timestamp: expect.any(Date)
    },
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank',
      collectionId: small._id,
      diff: { _id: [String(small._id)], size: ['small'] },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should get a diff by version', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  await small.save();
  small.size = 'large';
  await small.save();
  let diffs = await small.getDiff('1.0.0');

  expect(diffs).toEqual({
    _id: expect.any(Object),
    version: '1.0.0',
    collectionName: 'tank',
    collectionId: small._id,
    diff: { size: ['small', 'large'] },
    timestamp: expect.any(Date)
  });
});

test('should get all versions', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  await small.save();
  small.size = 'large';
  await small.save();
  let versions = await small.getVersions();

  expect(versions).toEqual([
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank',
      collectionId: small._id,
      object: { _id: String(small._id), size: 'small' },
      timestamp: expect.any(Date)
    },
    {
      _id: expect.any(Object),
      version: '1.0.0',
      collectionName: 'tank',
      collectionId: small._id,
      object: { _id: String(small._id), size: 'large' },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should get a version', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  await small.save();
  small.size = 'large';
  await small.save();
  let version = await small.getVersion('1.0.0');

  expect(version).toEqual({
    _id: expect.any(Object),
    version: '1.0.0',
    collectionName: 'tank',
    collectionId: small._id,
    object: { _id: String(small._id), size: 'large' },
    timestamp: expect.any(Date)
  });
});

test('should compare two versions', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });

  await small.save();
  small.size = 'large';
  await small.save();
  let diff = await small.compareVersions('0.0.0', '1.0.0');

  expect(diff).toEqual({
    diff: {
      size: ['small', 'large']
    },
    left: { _id: String(small._id), size: 'small' },
    right: { _id: String(small._id), size: 'large' }
  });
});

test('should create history for sub documents', async (t) => {
  let parentSchema = mongoose.Schema({tanks: [EmbeddedSchema]});
  let Parent = mongoose.model('parent', parentSchema);

  let tanks = new Parent({tanks: [{size: 'small'}]});
  await tanks.save();
  tanks.tanks[0].size = 'large';
  await tanks.save();

  let tank = tanks.tanks[0];
  let diffs = await tank.getDiffs();

  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '1.0.0',
      collectionName: 'EmbeddedCollection',
      collectionId: tank._id,
      diff: { size: ['small', 'large'] },
      timestamp: expect.any(Date)
    },
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'EmbeddedCollection',
      collectionId: tank._id,
      diff: { _id: [String(tank._id)], size: ['small'] },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should sort patch versions above 10 correctly', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });
  await small.save();

  for (let i = 0; i < 10; i++) {
    small.size = 'small-' + i;
    small.__history = { type: 'patch' };
    await small.save();
  }
  let versions = await small.getVersions();
  expect(versions[versions.length - 1].version).toBe('0.0.10');

});

test('should sort minor versions above 10 correctly', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });
  await small.save();

  for (let i = 0; i < 10; i++) {
    small.size = 'small-' + i;
    small.__history = { type: 'minor' };
    await small.save();
  }
  let versions = await small.getVersions();
  expect(versions[versions.length - 1].version).toBe('0.10.0');

});

test('should sort major versions above 10 correctly', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });
  await small.save();

  for (let i = 0; i < 10; i++) {
    small.size = 'small-' + i;
    await small.save();
  }
  let versions = await small.getVersions();
  expect(versions[versions.length - 1].version).toBe('10.0.0');

});

test('should get a version above 10 correctly', async (t) => {
  let Tank = mongoose.model('tank', CompiledSchema);
  let small = new Tank({
    size: 'small'
  });
  await small.save();

  for (let i = 0; i < 10; i++) {
    small.size = 'small-' + i;
    await small.save();
  }
  let version = await small.getVersion('10.0.0');
  expect(version.object.size).toBe('small-9');

});

test('should save only the id of a populated field', async (t) => {
  let Schema = mongoose.Schema({ name: 'string', size: 'string', driver: {type: mongoose.Schema.Types.ObjectId, ref: 'driver'} });
  Schema.plugin(HistoryPlugin);
  let Tank = mongoose.model('tank2', Schema);

  let DriverSchema = mongoose.Schema({name: 'string'});
  let Driver = mongoose.model('driver', DriverSchema);

  let driver = new Driver({name: 'John Doe'});
  driver = await driver.save();

  let small = new Tank({
    size: 'small',
    driver
  });
  await small.populate('driver').execPopulate();

  // The tank must have the driver field populated
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'John Doe', __v: 0}
  });


  // Save the document
  await small.save();

  // The document populated fields must be preserved after the save method
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'John Doe', __v: 0},
    __v: 0
  });

  let diffs = await small.getDiffs();

  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank2',
      collectionId: small._id,
      diff: { _id: [String(small._id)], size: ['small'], driver: [String(driver._id)] },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should not save a history if a property of a populated field is modified', async (t) => {
  let Schema = mongoose.Schema({name: 'string', size: 'string', driver: {type: mongoose.Schema.Types.ObjectId, ref: 'driver2'} });
  Schema.plugin(HistoryPlugin);
  let Tank = mongoose.model('tank3', Schema);

  let DriverSchema = mongoose.Schema({name: 'string'});
  let Driver = mongoose.model('driver2', DriverSchema);

  let driver = new Driver({name: 'John Doe'});
  driver = await driver.save();

  let small = new Tank({
    size: 'small',
    driver
  });
  await small.populate('driver').execPopulate();

  // The tank must have the driver field populated
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'John Doe', __v: 0}
  });


  // Save the document
  await small.save();

  driver.name = 'Jane Doe';
  driver = await driver.save();
  await small.populate('driver').execPopulate();

  // The populated field must have the new name
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'Jane Doe', __v: 0},
    __v: 0
  });

  // This save must not create a history entry
  await small.save();

  let diffs = await small.getDiffs();
  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank3',
      collectionId: small._id,
      diff: { _id: [String(small._id)], size: ['small'], driver: [String(driver._id)] },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should save the whole object of a populated field if savePopulated config is true', async (t) => {
  let Schema = mongoose.Schema({name: 'string', size: 'string', driver: {type: mongoose.Schema.Types.ObjectId, ref: 'driver3'} });
  Schema.plugin(
    MongooseHistoryPlugin(Object.assign({}, options, {modelName: '__populated_histories', ignorePopulatedFields: false}))
  );
  let Tank = mongoose.model('tank4', Schema);

  let DriverSchema = mongoose.Schema({name: 'string'});
  let Driver = mongoose.model('driver3', DriverSchema);

  let driver = new Driver({name: 'John Doe'});
  driver = await driver.save();

  let small = new Tank({
    size: 'small',
    driver
  });
  await small.populate('driver').execPopulate();

  // The tank must have the driver field populated
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'John Doe', __v: 0}
  });

  // Save the document
  await small.save();

  // The document populated fields must be preserved after the save method
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'John Doe', __v: 0},
    __v: 0
  });

  let diffs = await small.getDiffs();

  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank4',
      collectionId: small._id,
      diff: { _id: [String(small._id)], size: ['small'], driver: [{_id: String(driver._id), name: 'John Doe', __v: 0}] },
      timestamp: expect.any(Date)
    }
  ]);
});

test('should save a history if a property of a populated field is modified', async (t) => {
  let Schema = mongoose.Schema({name: 'string', size: 'string', driver: {type: mongoose.Schema.Types.ObjectId, ref: 'driver4'} });
  Schema.plugin(
    MongooseHistoryPlugin(Object.assign({}, options, {modelName: '__populated_histories2', ignorePopulatedFields: false}))
  );
  let Tank = mongoose.model('tank5', Schema);

  let DriverSchema = mongoose.Schema({name: 'string'});
  let Driver = mongoose.model('driver4', DriverSchema);

  let driver = new Driver({name: 'John Doe'});
  driver = await driver.save();

  let small = new Tank({
    size: 'small',
    driver
  });
  await small.populate('driver').execPopulate();

  // The tank must have the driver field populated
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'John Doe', __v: 0}
  });

  // Save the document
  await small.save();

  driver.name = 'Jane Doe';
  driver = await driver.save();
  await small.populate('driver').execPopulate();

  // The populated field must have the new name
  expect(small.toJSON()).toEqual({
    _id: small._id,
    size: 'small',
    driver: {_id: driver._id, name: 'Jane Doe', __v: 0},
    __v: 0
  });

  // This save must not create a history entry
  await small.save();

  let diffs = await small.getDiffs();
  expect(diffs).toEqual([
    {
      _id: expect.any(Object),
      version: '1.0.0',
      collectionName: 'tank5',
      collectionId: small._id,
      diff: { driver: {name: ['John Doe', 'Jane Doe']} },
      timestamp: expect.any(Date)
    },
    {
      _id: expect.any(Object),
      version: '0.0.0',
      collectionName: 'tank5',
      collectionId: small._id,
      diff: { _id: [String(small._id)], size: ['small'], driver: [{_id: String(driver._id), name: 'John Doe', __v: 0}] },
      timestamp: expect.any(Date)
    }
  ]);
});


test('should test the readme example', async (t) => {

  // Default options
  let options = {
    mongoose: mongoose, // A mongoose instance
    userCollection: 'users', // Colletcion to ref when you pass an user id
    accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
    userFieldName: 'user', // Name of the property for the user
    accountFieldName: 'account', // Name of the property of the account if any
    timestampFieldName: 'timestamp', // Name of the property of the timestamp
    methodFieldName: 'method', // Name of the property of the method
    ignore: [], // List of fields to ignore when compare changes
    noDiffSave: false, // If true save event even if there are no changes
    noDiffSaveOnMethods: ['delete'], // If a method is in this list, it saves history even if there is no diff.
    noEventSave: true, // If false save only when __history property is passed
    modelName: '__histories_test', // Name of the collection for the histories
    embeddedDocument: false, // Is this a sub document
    embeddedModelName: '', // Name of model if used with embedded document

    // If true save only the _id of the populated fields
    // If false save the whole object of the populated fields
    // If false and a populated field property changes it triggers a new history
    // You need to populate the field after a change is made on the original document or it will not catch the differences
    ignorePopulatedFields: true
  };

  // Add the plugin to the schema with default options
  let Schema = mongoose.Schema({ name: 'string', size: 'string' });
  Schema.plugin(MongooseHistoryPlugin(options));

  // Create a model
  let Tank = mongoose.model('tank6', Schema);

  // Create a document
  let small = new Tank({
    size: 'small',
    // History property is optional by default
    __history: {
      event: 'created',
      user: undefined, // An object id of the user that generate the event
      reason: undefined,
      data: undefined, // Additional data to save with the event
      type: undefined, // One of 'patch', 'minor', 'major'. If undefined defaults to 'major'
      method: 'newTank' // Optional and intended for method reference
    }
  });

  small = await small.save();

  small.name = 'Small tank';

  // History property is optional by default
  small.__history = {
    event: 'updated',
    user: undefined,
    reason: undefined,
    data: undefined,
    type: undefined,
    method: 'updateTank'
  };

  small = await small.save();

  // All options are optional
  let query = {
    find: {}, // Must be an object
    select: {}, // Must be an object
    sort: '',
    populate: '',
    limit: 20
  };

  // Get the diff histories in JsonDiffPatch format
  let diffs = await small.getDiffs(query);

  // Get a diff history in JsonDiffPatch format
  let diff = await small.getDiff('1.0.0');

  // Get the versions
  let versions = await small.getVersions(query);

  // Get a version
  let version = await small.getVersion('1.0.0');

  // Compare two versions
  let compare = await small.compareVersions('0.0.0', '1.0.0');

  expect(diffs).toEqual([
    { version: '1.0.0',
      diff: { name: ['Small tank'] },
      event: 'updated',
      method: 'updateTank',
      timestamp: expect.any(Date)
    },
    { version: '0.0.0',
      diff: { _id: [String(small._id)], size: ['small'] },
      event: 'created',
      method: 'newTank',
      timestamp: expect.any(Date)
    }
  ]);

  expect(diff).toEqual({
    _id: expect.any(Object),
    version: '1.0.0',
    collectionName: 'tank6',
    collectionId: small._id,
    diff: { name: ['Small tank'] },
    event: 'updated',
    method: 'updateTank',
    timestamp: expect.any(Date)
  });

  expect(versions).toEqual([
    { version: '1.0.0',
      event: 'updated',
      method: 'updateTank',
      timestamp: expect.any(Date),
      object: { name: 'Small tank' }
    },
    { version: '0.0.0',
      event: 'created',
      method: 'newTank',
      timestamp: expect.any(Date),
      object: {
        name: 'Small tank',
        _id: String(small._id),
        size: 'small'
      }
    }
  ]);

  expect(version).toEqual({
    _id: expect.any(Object),
    version: '1.0.0',
    collectionName: 'tank6',
    collectionId: small._id,
    event: 'updated',
    method: 'updateTank',
    timestamp: expect.any(Date),
    object: {
      _id: String(small._id),
      size: 'small',
      name: 'Small tank'
    }
  });

  expect(compare).toEqual({
    diff: { name: ['Small tank'] },
    left: { _id: String(small._id), size: 'small' },
    right: {
      _id: String(small._id),
      size: 'small',
      name: 'Small tank'
    }
  });

});
