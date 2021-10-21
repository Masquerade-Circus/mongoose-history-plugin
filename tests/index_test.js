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
  collectionIdType: false, // Cast type for _id (support for other binary types like uuid) defaults to ObjectId
  ignore: [], // List of fields to ignore when compare changes
  noDiffSave: false, // If true save event even if there are no changes
  noDiffSaveOnMethods: ['delete'], // If a method is in this list, it saves history even if there is no diff.
  noEventSave: true, // If false save only when __history property is passed
  modelName: '__histories', // Name of the collection for the histories
  startingVersion: '0.0.0', // Default starting version

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


test('should add the plugin to a schema', done => {
	// Create a new schema
	const Schema = mongoose.Schema({ name: 'string', size: 'string' });
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
	return done();
});

test('should test methods added to the schema', done => {
	const Schema = mongoose.Schema({ name: 'string', size: 'string' });
	Schema.plugin(HistoryPlugin);

	expect(Schema.methods).toEqual({
		getDiffs: expect.any(Function),
		getDiff: expect.any(Function),
		getVersion: expect.any(Function),
		getVersions: expect.any(Function),
		compareVersions: expect.any(Function)
	});
	return done();
});

test('should test methods added to the model', done => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = new Tank({
		size: 'small'
	});

	expect(typeof small.getDiffs).toEqual('function');
	expect(typeof small.getDiff).toEqual('function');
	expect(typeof small.getVersion).toEqual('function');
	expect(typeof small.getVersions).toEqual('function');
	expect(typeof small.compareVersions).toEqual('function');
	return done();
});

test('should create history when save', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	const diffs = await small.getDiffs();

	return expect(diffs).toEqual([
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

test('should create history when save a change', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'medium';
	await small.save();
	small.size = 'large';
	await small.save();
	const diffs = await small.getDiffs();

	return expect(diffs).toEqual([
		{
			_id: expect.any(Object),
			version: '2.0.0',
			collectionName: 'tank',
			collectionId: small._id,
			diff: { size: ['medium', 'large'] },
			timestamp: expect.any(Date)
		},
		{
			_id: expect.any(Object),
			version: '1.0.0',
			collectionName: 'tank',
			collectionId: small._id,
			diff: { size: ['small', 'medium'] },
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

test('should get a diff by version', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'large';
	await small.save();
	const diffs = await small.getDiff('1.0.0');

	return expect(diffs).toEqual({
		_id: expect.any(Object),
		version: '1.0.0',
		collectionName: 'tank',
		collectionId: small._id,
		diff: { size: ['small', 'large'] },
		timestamp: expect.any(Date)
	});
});

test('should get all versions', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'large';
	await small.save();
	const versions = await small.getVersions();

	return expect(versions).toEqual([
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

test('should get a version', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'large';
	await small.save();
	const version = await small.getVersion('1.0.0');

	return expect(version).toEqual({
		_id: expect.any(Object),
		version: '1.0.0',
		collectionName: 'tank',
		collectionId: small._id,
		object: { _id: String(small._id), size: 'large' },
		timestamp: expect.any(Date)
	});
});

test('should compare two versions', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'large';
	await small.save();
	const diff = await small.compareVersions('0.0.0', '1.0.0');

	return expect(diff).toEqual({
		diff: {
			size: ['small', 'large']
		},
		left: { _id: String(small._id), size: 'small' },
		right: { _id: String(small._id), size: 'large' }
	});
});

test('should compare left version to older version when right version does not exist', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'large';
	await small.save();
	const diff = await small.compareVersions('0.0.0', '2.0.0');

	return expect(diff).toEqual({
		diff: {
			size: ['small', 'large']
		},
		left: { _id: String(small._id), size: 'small' },
		right: { _id: String(small._id), size: 'large' }
	});
});

test('should get the oldest version when provided semver does not exist', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	small.size = 'large';
	await small.save();
	const version = await small.getVersion('2.0.0');

	return expect(version).toEqual({
		_id: expect.any(Object),
		version: '1.0.0',
		collectionName: 'tank',
		collectionId: small._id,
		object: { _id: String(small._id), size: 'large' },
		timestamp: expect.any(Date)
	});
});

test('should create history for sub documents', async () => {
	const parentSchema = mongoose.Schema({ tanks: [EmbeddedSchema] });
	const Parent = mongoose.model('parent', parentSchema);

	const tanks = await new Parent({ tanks: [{ size: 'small' }] }).save();

	tanks.tanks[0].size = 'large';
	await tanks.save();

	const tank = tanks.tanks[0];
	const diffs = await tank.getDiffs();

	return expect(diffs).toEqual([
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

test('should sort patch versions above 10 correctly', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	for (let i = 0; i < 10; i += 1) {
		small.size = 'small-' + i;
		small.__history = { type: 'patch' };
		// eslint-disable-next-line no-await-in-loop
		await small.save();
	}
	const versions = await small.getVersions();
	return expect(versions[versions.length - 1].version).toBe('0.0.10');
});

test('should sort minor versions above 10 correctly', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	for (let i = 0; i < 10; i += 1) {
		small.size = 'small-' + i;
		small.__history = { type: 'minor' };
		// eslint-disable-next-line no-await-in-loop
		await small.save();
	}
	const versions = await small.getVersions();
	return expect(versions[versions.length - 1].version).toBe('0.10.0');
});

test('should sort major versions above 10 correctly', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	for (let i = 0; i < 10; i += 1) {
		small.size = 'small-' + i;
		// eslint-disable-next-line no-await-in-loop
		await small.save();
	}
	const versions = await small.getVersions();
	return expect(versions[versions.length - 1].version).toBe('10.0.0');
});

test('should get a version above 10 correctly', async () => {
	const Tank = mongoose.model('tank', CompiledSchema);
	const small = await new Tank({
		size: 'small'
	}).save();

	for (let i = 0; i < 10; i += 1) {
		small.size = 'small-' + i;
		// eslint-disable-next-line no-await-in-loop
		await small.save();
	}
	const version = await small.getVersion('10.0.0');
	expect(version.object.size).toBe('small-9');
});

test('should save only the id of a populated field', async () => {
	const Schema = mongoose.Schema({
		name: 'string',
		size: 'string',
		driver: { type: mongoose.Schema.Types.ObjectId, ref: 'driver' }
	});
	Schema.plugin(HistoryPlugin);
	const Tank = mongoose.model('tank2', Schema);

	const DriverSchema = mongoose.Schema({ name: 'string' });
	const Driver = mongoose.model('driver', DriverSchema);

	const driver = await new Driver({ name: 'John Doe' }).save();

	const small = new Tank({
		size: 'small',
		driver
	});
	await small.populate('driver').execPopulate();

	// The tank must have the driver field populated
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'John Doe', __v: 0 }
	});

	// Save the document
	await small.save();

	// The document populated fields must be preserved after the save method
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'John Doe', __v: 0 },
		__v: 0
	});

	const diffs = await small.getDiffs();
	return expect(diffs).toEqual([
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

test('should not save a history if a property of a populated field is modified', async () => {
	const Schema = mongoose.Schema({
		name: 'string',
		size: 'string',
		driver: { type: mongoose.Schema.Types.ObjectId, ref: 'driver2' }
	});
	Schema.plugin(HistoryPlugin);
	const Tank = mongoose.model('tank3', Schema);

	const DriverSchema = mongoose.Schema({ name: 'string' });
	DriverSchema.plugin(HistoryPlugin);
	const Driver = mongoose.model('driver2', DriverSchema);

	const driver = await new Driver({ name: 'John Doe' }).save();

	const small = new Tank({
		size: 'small',
		driver
	});
	await small.populate('driver').execPopulate();

	// The tank must have the driver field populated
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'John Doe', __v: 0 }
	});

	// Save the document
	await small.save();

	driver.name = 'Jane Doe';
	await driver.save();
	await small.populate('driver').execPopulate();

	// The populated field must have the new name
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'Jane Doe', __v: 0 },
		__v: 0
	});

	// There should be a new history for the driver
	const driverDiffs = await driver.getVersions();
	expect(driverDiffs.pop().version).toBe('1.0.0');

	// This save must not create a history entry for the tank
	await small.save();

	const diffs = await small.getDiffs();
	return expect(diffs).toEqual([
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

test('should save the whole object of a populated field if savePopulated config is true', async () => {
	const Schema = mongoose.Schema({
		name: 'string',
		size: 'string',
		driver: { type: mongoose.Schema.Types.ObjectId, ref: 'driver3' }
	});
	Schema.plugin(MongooseHistory({ ...options, modelName: '__populated_histories', ignorePopulatedFields: false }));
	const Tank = mongoose.model('tank4', Schema);

	const DriverSchema = mongoose.Schema({ name: 'string' });
	const Driver = mongoose.model('driver3', DriverSchema);

	const driver = await new Driver({ name: 'John Doe' }).save();

	const small = new Tank({
		size: 'small',
		driver
	});
	await small.populate('driver').execPopulate();

	// The tank must have the driver field populated
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'John Doe', __v: 0 }
	});

	// Save the document
	await small.save();

	// The document populated fields must be preserved after the save method
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'John Doe', __v: 0 },
		__v: 0
	});

	const diffs = await small.getDiffs();

	return expect(diffs).toEqual([
		{
			_id: expect.any(Object),
			version: '0.0.0',
			collectionName: 'tank4',
			collectionId: small._id,
			diff: {
				_id: [String(small._id)],
				size: ['small'],
				driver: [{ _id: String(driver._id), name: 'John Doe', __v: 0 }]
			},
			timestamp: expect.any(Date)
		}
	]);
});

test('should save a history if a property of a populated field is modified', async () => {
	const Schema = mongoose.Schema({
		name: 'string',
		size: 'string',
		driver: { type: mongoose.Schema.Types.ObjectId, ref: 'driver4' }
	});
	Schema.plugin(MongooseHistory({ ...options, modelName: '__populated_histories2', ignorePopulatedFields: false }));
	const Tank = mongoose.model('tank5', Schema);

	const DriverSchema = mongoose.Schema({ name: 'string' });
	const Driver = mongoose.model('driver4', DriverSchema);

	const driver = await new Driver({ name: 'John Doe' }).save();

	const small = new Tank({
		size: 'small',
		driver
	});
	await small.populate('driver').execPopulate();

	// The tank must have the driver field populated
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'John Doe', __v: 0 }
	});

	// Save the document
	await small.save();

	driver.name = 'Jane Doe';
	await driver.save();
	await small.populate('driver').execPopulate();

	// The populated field must have the new name
	expect(small.toJSON()).toEqual({
		_id: small._id,
		size: 'small',
		driver: { _id: driver._id, name: 'Jane Doe', __v: 0 },
		__v: 0
	});

	// This save must not create a history entry
	await small.save();

	const diffs = await small.getDiffs();
	return expect(diffs).toEqual([
		{
			_id: expect.any(Object),
			version: '1.0.0',
			collectionName: 'tank5',
			collectionId: small._id,
			diff: { driver: { name: ['John Doe', 'Jane Doe'] } },
			timestamp: expect.any(Date)
		},
		{
			_id: expect.any(Object),
			version: '0.0.0',
			collectionName: 'tank5',
			collectionId: small._id,
			diff: {
				_id: [String(small._id)],
				size: ['small'],
				driver: [{ _id: String(driver._id), name: 'John Doe', __v: 0 }]
			},
			timestamp: expect.any(Date)
		}
	]);
});

test('should test the readme example', async () => {
	// Default options
	const optionsExample = {
		mongoose, // A mongoose instance
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
	const Schema = mongoose.Schema({ name: 'string', size: 'string' });
	Schema.plugin(MongooseHistory(optionsExample));

	// Create a model
	const Tank = mongoose.model('tank6', Schema);

	// Create a document
	const small = await new Tank({
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
	}).save();

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
	await small.save();

	// Create another history version
	small.name = 'Smallest tank';

	// History property is optional by default
	small.__history = {
		event: 'updated',
		user: undefined,
		reason: undefined,
		data: undefined,
		type: undefined,
		method: 'updateTank'
	};
	await small.save();

	// All options are optional
	const query = {
		find: {}, // Must be an object
		select: {}, // Must be an object
		sort: '',
		populate: '',
		limit: 20
	};

	// Get the diff histories in JsonDiffPatch format
	const diffs = await small.getDiffs(query);

	// Get a diff history in JsonDiffPatch format
	const diff = await small.getDiff('1.0.0');

	// Get the versions
	const versions = await small.getVersions(query);

	// Get a version
	const version = await small.getVersion('1.0.0');

	// Compare two versions
	const compare = await small.compareVersions('0.0.0', '1.0.0');

	expect(diffs).toEqual([
		{
			version: '2.0.0',
			diff: { name: ['Small tank', 'Smallest tank'] },
			event: 'updated',
			method: 'updateTank',
			timestamp: expect.any(Date)
		},
		{
			version: '1.0.0',
			diff: { name: ['Small tank'] },
			event: 'updated',
			method: 'updateTank',
			timestamp: expect.any(Date)
		},
		{
			version: '0.0.0',
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
		{
			version: '2.0.0',
			event: 'updated',
			method: 'updateTank',
			timestamp: expect.any(Date),
			object: { name: 'Smallest tank' }
		},
		{
			version: '1.0.0',
			event: 'updated',
			method: 'updateTank',
			timestamp: expect.any(Date),
			object: { name: 'Small tank' }
		},
		{
			version: '0.0.0',
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

	return expect(compare).toEqual({
		diff: { name: ['Small tank'] },
		left: { _id: String(small._id), size: 'small' },
		right: {
			_id: String(small._id),
			size: 'small',
			name: 'Small tank'
		}
	});
});

test('should create history with starting version', async () => {
	const HistoryPluginTest = MongooseHistory({
		...options,
		modelName: '__histories_version',
		startingVersion: '1.0.0'
	});

	const CompiledSchema2 = mongoose.Schema({ name: 'string', size: 'string' });
	CompiledSchema2.plugin(HistoryPluginTest);

	const Tank = mongoose.model('tank7', CompiledSchema2);
	const small = await new Tank({
		size: 'small'
	}).save();
	const diffs = await small.getDiffs();

	return expect(diffs).toEqual([
		{
			_id: expect.any(Object),
			version: '1.0.0',
			collectionName: 'tank7',
			collectionId: small._id,
			diff: { _id: [String(small._id)], size: ['small'] },
			timestamp: expect.any(Date)
		}
	]);
});
