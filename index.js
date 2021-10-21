const JsonDiffPatch = require('jsondiffpatch');
const semver = require('semver');

const historyPlugin = (options = {}) => {
	const pluginOptions = {
		mongoose: false, // A mongoose instance
		modelName: '__histories', // Name of the collection for the histories
		embeddedDocument: false, // Is this a sub document
		embeddedModelName: '', // Name of model if used with embedded document
		userCollection: 'users', // Collection to ref when you pass an user id
		userCollectionIdType: false, // Type for user collection ref id, defaults to ObjectId
		accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
		accountCollectionIdType: false, // Type for account collection ref id, defaults to ObjectId
		userFieldName: 'user', // Name of the property for the user
		accountFieldName: 'account', // Name of the property of the account if any
		timestampFieldName: 'timestamp', // Name of the property of the timestamp
		methodFieldName: 'method', // Name of the property of the method
		collectionIdType: false, // Cast type for _id (support for other binary types like uuid)
		ignore: [], // List of fields to ignore when compare changes
		noDiffSave: false, // Save event even if there are no changes
		noDiffSaveOnMethods: [], // Save event even if there are no changes if method matches
		noEventSave: true, // If false save only when __history property is passed
		startingVersion: '0.0.0', // Default starting version

		// If true save only the _id of the populated fields
		// If false save the whole object of the populated fields
		// If false and a populated field property changes it triggers a new history
		// You need to populate the field after a change is made on the original document or it will not catch the differences
		ignorePopulatedFields: true
	};

	Object.assign(pluginOptions, options);

	if (pluginOptions.mongoose === false) {
		throw new Error('You need to pass a mongoose instance');
	}

	const { mongoose } = pluginOptions;

	const collectionIdType = options.collectionIdType || mongoose.Schema.Types.ObjectId;
	const userCollectionIdType = options.userCollectionIdType || mongoose.Schema.Types.ObjectId;
	const accountCollectionIdType = options.accountCollectionIdType || mongoose.Schema.Types.ObjectId;

	const Schema = new mongoose.Schema(
		{
			collectionName: String,
			collectionId: { type: collectionIdType },
			diff: {},
			event: String,
			reason: String,
			data: { type: mongoose.Schema.Types.Mixed },
			[pluginOptions.userFieldName]: {
				type: userCollectionIdType,
				ref: pluginOptions.userCollection
			},
			[pluginOptions.accountFieldName]: {
				type: accountCollectionIdType,
				ref: pluginOptions.accountCollection
			},
			version: { type: String, default: pluginOptions.startingVersion },
			[pluginOptions.timestampFieldName]: Date,
			[pluginOptions.methodFieldName]: String
		},
		{
			collection: pluginOptions.modelName
		}
	);

	Schema.set('minimize', false);
	Schema.set('versionKey', false);
	Schema.set('strict', true);

	Schema.pre('save', function (next) {
		this[pluginOptions.timestampFieldName] = new Date();
		next();
	});

	const Model = mongoose.model(pluginOptions.modelName, Schema);

	const getModelName = defaultName => (pluginOptions.embeddedDocument ? pluginOptions.embeddedModelName : defaultName);

	const jdf = JsonDiffPatch.create({
		objectHash: (obj, index) => {
			if (obj !== undefined) {
				return (obj._id && obj._id.toString()) || obj.id || obj.key || '$$index:' + index;
			}

			return '$$index:' + index;
		}
	});

	const query = (method = 'find', queryOptions = {}) => {
		const requestedQuery = Model[method](queryOptions.find || {});

		if (queryOptions.select !== undefined) {
			Object.assign(queryOptions.select, {
				_id: 0,
				collectionId: 0,
				collectionName: 0
			});

			requestedQuery.select(queryOptions.select);
		}

		if (queryOptions.sort) requestedQuery.sort(queryOptions.sort);
		if (queryOptions.populate) requestedQuery.populate(queryOptions.populate);
		if (queryOptions.limit) requestedQuery.limit(queryOptions.limit);

		return requestedQuery.lean();
	};

	const getPreviousVersion = async document => {
		// get the oldest version from the history collection
		const versions = await document.getVersions();
		return versions[versions.length - 1] ? versions[versions.length - 1].object : {};
	};
	// we only depopulate the first depth of fields
	const getPopulatedFields = document => Object.keys(document._doc).filter(field => document.populated(field));

	// we only depopulate the first depth of fields
	const depopulate = (document, populatedFields) => populatedFields.forEach(field => document.depopulate(field));

	const repopulate = async (document, populatedFields) =>
		Promise.all(populatedFields.map(field => document.populate(field).execPopulate()));

	const cloneObjectByJson = object => (object ? JSON.parse(JSON.stringify(object)) : {});

	const cleanFields = object => {
		delete object.__history;
		delete object.__v;

		pluginOptions.ignore.forEach(e => delete object[pluginOptions.ignore[e]]);
		return object;
	};

	const getDiff = ({ prev, current, document, forceSave }) => {
		let diff = jdf.diff(prev, current);

		let saveWithoutDiff = false;
		if (document.__history && pluginOptions.noDiffSaveOnMethods.length) {
			const method = document.__history[pluginOptions.methodFieldName];
			if (pluginOptions.noDiffSaveOnMethods.includes(method)) {
				saveWithoutDiff = true;
				if (forceSave) {
					diff = prev;
				}
			}
		}

		return {
			diff,
			saveWithoutDiff
		};
	};

	const saveHistory = async ({ document, diff }) => {
		const lastHistory = await Model.findOne({
			collectionName: getModelName(document.constructor.modelName),
			collectionId: document._id
		})
			.sort('-' + pluginOptions.timestampFieldName)
			.select({ version: 1 });

		const obj = {};
		obj.collectionName = getModelName(document.constructor.modelName);
		obj.collectionId = document._id;
		obj.diff = diff || {};

		if (document.__history) {
			obj.event = document.__history.event;
			obj[pluginOptions.userFieldName] = document.__history[pluginOptions.userFieldName];
			obj[pluginOptions.accountFieldName] =
				document[pluginOptions.accountFieldName] || document.__history[pluginOptions.accountFieldName];
			obj.reason = document.__history.reason;
			obj.data = document.__history.data;
			obj[pluginOptions.methodFieldName] = document.__history[pluginOptions.methodFieldName];
		}

		let version;

		if (lastHistory) {
			const type = document.__history && document.__history.type ? document.__history.type : 'major';

			version = semver.inc(lastHistory.version, type);
		}

		obj.version = version || pluginOptions.startingVersion;
		Object.keys(obj).forEach(key => obj[key] === undefined && delete obj[key]);

		const history = new Model(obj);

		document.__history = undefined;
		await history.save();
	};

	return function (schema) {
		schema.add({
			__history: { type: mongoose.Schema.Types.Mixed }
		});

		const preSave = function (forceSave) {
			return async function (next) {
				const currentDocument = this;
				if (currentDocument.__history !== undefined || pluginOptions.noEventSave) {
					try {
						const previousVersion = await getPreviousVersion(currentDocument);
						const populatedFields = getPopulatedFields(currentDocument);

						if (pluginOptions.ignorePopulatedFields) {
							depopulate(currentDocument, populatedFields);
						}

						const currentObject = cleanFields(cloneObjectByJson(currentDocument));
						const previousObject = cleanFields(cloneObjectByJson(previousVersion));

						if (pluginOptions.ignorePopulatedFields) {
							await repopulate(currentDocument, populatedFields);
						}

						const { diff, saveWithoutDiff } = getDiff({
							current: currentObject,
							prev: previousObject,
							document: currentDocument,
							forceSave
						});

						if (diff || pluginOptions.noDiffSave || saveWithoutDiff) {
							await saveHistory({ document: currentDocument, diff });
						}

						return next();
					} catch (error) {
						return next(error);
					}
				}

				return next();
			};
		};

		schema.pre('save', preSave(false));

		schema.pre('remove', preSave(true));

		// diff.find
		schema.methods.getDiffs = function (getDiffsOptions = {}) {
			getDiffsOptions.find = getDiffsOptions.find || {};
			Object.assign(getDiffsOptions.find, {
				collectionName: getModelName(this.constructor.modelName),
				collectionId: this._id
			});

			getDiffsOptions.sort = getDiffsOptions.sort || '-' + pluginOptions.timestampFieldName;

			return query('find', getDiffsOptions);
		};

		// diff.get
		schema.methods.getDiff = function (version, getDiffOptions = {}) {
			getDiffOptions.find = getDiffOptions.find || {};
			Object.assign(getDiffOptions.find, {
				collectionName: getModelName(this.constructor.modelName),
				collectionId: this._id,
				version
			});

			getDiffOptions.sort = getDiffOptions.sort || '-' + pluginOptions.timestampFieldName;

			return query('findOne', getDiffOptions);
		};

		// versions.get
		schema.methods.getVersion = async function (version2get, includeObject = true) {
			const histories = await this.getDiffs({
				sort: pluginOptions.timestampFieldName
			});

			const lastVersion = histories[histories.length - 1];
			const firstVersion = histories[0];
			let history;
			let version = {};

			if (semver.gt(version2get, lastVersion.version)) {
				version2get = lastVersion.version;
			}

			if (semver.lt(version2get, firstVersion.version)) {
				version2get = firstVersion.version;
			}

			histories.forEach(item => {
				if (item.version === version2get) {
					history = item;
				}
			});

			if (!includeObject) {
				return history;
			}

			histories.forEach(item => {
				if (semver.lt(item.version, version2get) || item.version === version2get) {
					version = jdf.patch(version, item.diff);
				}
			});

			delete history.diff;
			history.object = version;

			return history;
		};

		// versions.compare
		schema.methods.compareVersions = async function (versionLeft, versionRight) {
			const versionLeftDocument = await this.getVersion(versionLeft);
			const versionRightDocument = await this.getVersion(versionRight);

			return {
				diff: jdf.diff(versionLeftDocument.object, versionRightDocument.object),
				left: versionLeftDocument.object,
				right: versionRightDocument.object
			};
		};

		// versions.find
		schema.methods.getVersions = async function (getVersionsOptions = {}, includeObject = true) {
			getVersionsOptions.sort = getVersionsOptions.sort || pluginOptions.timestampFieldName;

			const histories = await this.getDiffs(getVersionsOptions);

			if (!includeObject) {
				return histories;
			}

			let version = {};
			histories.forEach(e => {
				version = jdf.patch(version, e.diff);
				e.object = jdf.clone(version);
				delete e.diff;
			});

			return histories;
		};
	};
};

module.exports = historyPlugin;
