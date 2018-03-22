'use strict';

// Load modules

const Lab = require('lab');
const Code = require('code');
const Path = require('path');
const Fs = require('fs');
const KnexConfigs = require('./knexfile');
const TestSession = require('./utils/TestSession');
const TestSuiteRunner = require('./utils/TestSuiteRunner');
const SchwiftyMigration = require('../lib');
const Knex = require('knex');

// Test shortcuts

const lab = exports.lab = Lab.script({ schedule: false });
const expect = Code.expect;
const { describe, it, before } = lab;
const Utils = require('./utils');

const internals = {};

lab.afterEach((done) => {

    // Just brute clear out the db

    const { sessionForAfter, rollbackPath } = internals;

    if (sessionForAfter) {

        // Wipe the db!

        Utils.rollbackDb(sessionForAfter, rollbackPath, () => {

            internals.sessionForAfter = undefined;
            done();
        });
    }
    else {
        internals.sessionForAfter = undefined;
        done();
    }
});

const setOptionsForAfter = (session, rollbackPath) => {

    internals.sessionForAfter = session;
    internals.rollbackPath = rollbackPath;
};

const testUtils = {
    lab,
    expect,
    utils: Utils,
    setOptionsForAfter
};

const envDB = process.env.DB;
const testDbs = (envDB && [envDB]) || ['postgres'];

describe('SchwiftyMigration', () => {

    let initSessions = [];

    const getSessions = () => {

        const sessions = [];

        const promises = KnexConfigs.filter((knexConfig) => {

            // Only test the dbs specified in the `testDbs` array
            return testDbs.indexOf(knexConfig.client) !== -1;
        })
            .map((knexConfig) => {

                return new Promise((resolve, reject) => {

                    // Create all the test sessions

                    sessions.push(new TestSession({
                        options: { knexConfig },
                        next: () => {

                            resolve(...sessions);
                        }
                    }));
                });
            });

        return Promise.all(promises);
    };

    before({ timeout: 10000 }, () => {

        return new Promise((resolve, reject) => {

            getSessions()
                .then((args) => {

                    initSessions = args;
                    resolve(args);
                });
        });
    });

    it('errors if you give bad options', (done) => {

        SchwiftyMigration.genMigrationFile({
            invalid: 'options!'
        }, (err) => {

            expect(err).to.exist();
            expect(err.message).to.equal('Bad options passed to schwifty-migration: child \"migrationsDir\" fails because [\"migrationsDir\" is required]');
            done();
        });
    });

    it('errors on a knex that isn\'t pingable', (done) => {

        const badKnex = Knex({
            client: 'postgres',
            connection: {
                host: '1.2.3.4.5',
                user: 'postgres',
                password: 'postgres',
                database: 'schwifty_migration_test'
            }
        });

        SchwiftyMigration.genMigrationFile({
            models: [require('./migration-tests/Dog')],
            migrationsDir: 'some/path',
            knex: badKnex,
            mode: 'alter'
        }, (err) => {

            expect(err).to.exist();
            expect(err.message).to.equal('getaddrinfo ENOTFOUND 1.2.3.4.5 1.2.3.4.5:5432');
            done();
        });
    });

    it('returns early if models are empty', (done) => {

        const session = initSessions[0];

        SchwiftyMigration.genMigrationFile({
            models: [],
            migrationsDir: 'some/path',
            knex: session.knex,
            mode: 'alter'
        }, (err, output) => {

            expect(err).to.not.exist();
            expect(output).to.equal('No models passed');
            done();
        });
    });

    it('accepts absolute and relative migration file paths', (done) => {

        const session = initSessions[0];

        const absolutePath = Path.join(process.cwd(), 'test/migration-tests/migrations');
        const relativePath = './test/migration-tests/migrations';

        SchwiftyMigration.genMigrationFile({
            models: [require('./migration-tests/Dog')],
            migrationsDir: absolutePath,
            knex: session.knex,
            mode: 'alter'
        }, (err) => {

            expect(err).to.not.exist();

            SchwiftyMigration.genMigrationFile({
                models: [require('./migration-tests/Dog')],
                migrationsDir: relativePath,
                knex: session.knex,
                mode: 'alter'
            }, (err) => {

                expect(err).to.not.exist();

                Fs.readdirSync(absolutePath)
                    .forEach((migrationFile) => {

                        const filePath = Path.join(absolutePath, migrationFile);
                        Fs.unlinkSync(filePath);
                    });

                done();
            });
        });
    });

    it('Returns "No migration needed" when the db and models are in sync (no-op)', (done) => {

        const session = initSessions[0];
        const migrationsDir = './test/migration-tests/migrations';
        const seedPath = './test/migration-tests/seed';

        testUtils.setOptionsForAfter(session, seedPath);

        session.knex.migrate.latest({
            directory: seedPath
        })
            .then(() => {

                SchwiftyMigration.genMigrationFile({
                    models: [require('./migration-tests/Person')],
                    migrationsDir,
                    knex: session.knex,
                    mode: 'alter'
                }, (err, output) => {

                    expect(err).to.not.exist();
                    expect(output).to.equal('No migration needed');

                    Fs.readdirSync(migrationsDir)
                        .forEach((migrationFile) => {

                            const filePath = Path.join(migrationsDir, migrationFile);
                            Fs.unlinkSync(filePath);
                        });

                    done();
                });
            });
    });

    it('Suppresses alter and drop actions if mode is not set to "alter"', (done) => {

        const session = initSessions[0];
        const migrationsDir = './test/migration-tests/migrations';
        const seedPath = './test/migration-tests/seed';

        testUtils.setOptionsForAfter(session, seedPath);

        session.knex.migrate.latest({
            directory: seedPath
        })
            .then(() => {

                SchwiftyMigration.genMigrationFile({
                    models: [require('./migration-tests/AlterPerson')],
                    migrationsDir,
                    knex: session.knex,
                    mode: 'create'
                }, (err) => {

                    expect(err).to.not.exist();

                    const expectedMigrationPath = './test/migration-tests/mode-enforcement/create-mode/expected-migration.js';
                    const actualMigrationContents = testUtils.utils.getLatestMigration(migrationsDir);
                    const expectedMigrationContents = Fs.readFileSync(expectedMigrationPath).toString('utf8');

                    expect(actualMigrationContents).to.equal(expectedMigrationContents);

                    Fs.readdirSync(migrationsDir)
                        .forEach((migrationFile) => {

                            const filePath = Path.join(migrationsDir, migrationFile);
                            Fs.unlinkSync(filePath);
                        });

                    done();
                });
            });
    });

    it('Prints to the console on successful migration file generation', (done) => {

        const session = initSessions[0];
        const absolutePath = Path.join(process.cwd(), 'test/migration-tests/migrations');

        SchwiftyMigration.genMigrationFile({
            models: [require('./migration-tests/Dog')],
            migrationsDir: absolutePath,
            knex: session.knex,
            mode: 'alter'
        }, (err, output) => {

            expect(err).to.not.exist();

            expect(output.includes('_schwifty-migration.js')).to.equal(true);

            Fs.readdirSync(absolutePath)
                .forEach((migrationFile) => {

                    const filePath = Path.join(absolutePath, migrationFile);
                    Fs.unlinkSync(filePath);
                });

            done();
        });
    });

    it('errors on unsupported Joi schema in model', (done) => {

        const session = initSessions[0];
        const absolutePath = Path.join(process.cwd(), 'test/migration-tests/migrations');

        SchwiftyMigration.genMigrationFile({
            models: [require('./migration-tests/BadPerson')],
            migrationsDir: absolutePath,
            knex: session.knex,
            mode: 'alter'
        }, (err) => {

            expect(err).to.exist();
            expect(err.message).to.equal('Joi Schema type(s) "alternatives" not supported. Please fix mappings.js');
            done();
        });
    });

    it('creates new tables and columns', (done) => {

        initSessions.forEach((session) => {

            // Run migration tests for `create`
            const createRunner = new TestSuiteRunner('create', session, testUtils);
            createRunner.genTests();
        });

        done();
    });

    it('alters tables', (done) => {

        initSessions.forEach((session) => {

            // Run migration tests for `alter`
            const createRunner = new TestSuiteRunner('alter', session, testUtils);
            createRunner.genTests();
        });

        done();
    });

    it('integration testing', (done) => {

        initSessions.forEach((session) => {

            // Run migration tests for `alter`
            const createRunner = new TestSuiteRunner('integrated', session, testUtils);
            createRunner.genTests();
        });

        done();
    });
});
