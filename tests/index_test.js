import test from 'ava';
import expect from 'expect';
import DbHelper from './helpers/db';
import mongoose from 'mongoose';

const { start, close, MongooseHistoryPlugin } = DbHelper(mongoose);

test.before('Start server', start);
test.after.always('Close server', close);

// Default options
const options = {
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
  mongoose: mongoose // A mongoose instance
};

const HistoryPlugin = MongooseHistoryPlugin(options);

const CompiledSchema = mongoose.Schema({ name: 'string', size: 'string' });
CompiledSchema.plugin(HistoryPlugin);

const embeddedOptionDefaults = {embeddedDocument: true, embeddedModelName: 'EmbeddedCollection', modelName: '__embedded_histories'};
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
