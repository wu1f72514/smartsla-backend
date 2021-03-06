'use strict';

const request = require('supertest');
const path = require('path');
const Q = require('q');
const expect = require('chai').expect;
const { INDICES } = require('../../../../../backend/lib/constants');

describe('POST /ticketing/api/software', function() {
  let app, lib, helpers;
  let user1, user2;
  const password = 'secret';

  beforeEach(function(done) {
    helpers = this.helpers;
    app = this.app;
    lib = this.lib;

    const deployOptions = {
      fixtures: path.normalize(`${__dirname}/../../../fixtures/deployments`)
    };

    helpers.api.applyDomainDeployment('ticketingModule', deployOptions, (err, models) => {
      if (err) {
        return done(err);
      }

      user1 = models.users[1];
      user2 = models.users[2];

      lib.ticketingUserRole.create({
        user: user1._id,
        role: 'administrator'
      })
      .then(() => {
        lib.ticketingUserRole.create({
          user: user2._id,
          role: 'user'
        });
      })
      .then(() => done())
      .catch(err => done(err));
    });
  });

  afterEach(function(done) {
    helpers.mongo.dropDatabase(err => done(err));
  });

  it('should respond 400 if there is no name in payload', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));
      const newSoftware = {
        category: 'foo',
        versions: ['1']
      };

      req.send(newSoftware);
      req.expect(400)
        .end(helpers.callbacks.noErrorAnd(res => {
          expect(res.body).to.deep.equal({
            error: { code: 400, message: 'Bad Request', details: 'name is required' }
          });
          done();
        }));
    }));
  });

  it('should respond 400 if there is no category in payload', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));
      const newSoftware = {
        name: 'foo',
        versions: ['1']
      };

      req.send(newSoftware);
      req.expect(400)
        .end(helpers.callbacks.noErrorAnd(res => {
          expect(res.body).to.deep.equal({
            error: { code: 400, message: 'Bad Request', details: 'category is required' }
          });
          done();
        }));
    }));
  });

  it('should respond 400 if there is no versions in payload', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));
      const newSoftware = {
        name: 'foo',
        category: 'bar'
      };

      req.send(newSoftware);
      req.expect(400)
        .end(helpers.callbacks.noErrorAnd(res => {
          expect(res.body).to.deep.equal({
            error: { code: 400, message: 'Bad Request', details: 'versions is required' }
          });
          done();
        }));
    }));
  });

  it('should respond 400 if versions is not an array', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));
      const newSoftware = {
        name: 'foo',
        category: 'bar',
        versions: 'string'
      };

      req.send(newSoftware);
      req.expect(400)
        .end(helpers.callbacks.noErrorAnd(res => {
          expect(res.body).to.deep.equal({
            error: { code: 400, message: 'Bad Request', details: 'versions must be an array' }
          });
          done();
        }));
    }));
  });

  it('should respond 400 if versions is an empty array', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));
      const newSoftware = {
        name: 'foo',
        category: 'bar',
        versions: []
      };

      req.send(newSoftware);
      req.expect(400)
        .end(helpers.callbacks.noErrorAnd(res => {
          expect(res.body).to.deep.equal({
            error: { code: 400, message: 'Bad Request', details: 'versions must not be empty' }
          });
          done();
        }));
    }));
  });

  it('should respond 400 if name is taken', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));

      lib.software.create({
        name: 'foo',
        category: 'bar',
        versions: ['1']
      })
        .then(createdSofware => {
          const newSoftware = {
            name: createdSofware.name,
            category: 'bar',
            versions: ['1']
          };

          req.send(newSoftware);
          req.expect(400)
            .end(helpers.callbacks.noErrorAnd(res => {
              expect(res.body).to.deep.equal({
                error: { code: 400, message: 'Bad Request', details: 'name is taken' }
              });
              done();
            }));
        }, err => done(err || 'should resolve'));
    }));
  });

  it('should respond 400 if lowercase of name is taken', function(done) {
    helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));

      lib.software.create({
        name: 'Foo',
        category: 'bar',
        versions: ['1']
      })
        .then(() => {
          const newSoftware = {
            name: 'FoO',
            category: 'bar',
            versions: ['1']
          };

          req.send(newSoftware);
          req.expect(400)
            .end(helpers.callbacks.noErrorAnd(res => {
              expect(res.body).to.deep.equal({
                error: { code: 400, message: 'Bad Request', details: 'name is taken' }
              });
              done();
            }));
        }, err => done(err || 'should resolve'));
    }));
  });

  it('should respond 401 if not logged in', function(done) {
    helpers.api.requireLogin(app, 'post', '/ticketing/api/software', done);
  });

  it('should respond 403 if user is not an administrator', function(done) {
    helpers.api.loginAsUser(app, user2.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
      const req = requestAsMember(request(app).post('/ticketing/api/software'));

      req.expect(403)
        .end(helpers.callbacks.noErrorAnd(res => {
          expect(res.body).to.deep.equal({
            error: { code: 403, message: 'Forbidden', details: 'User is not the administrator' }
          });
          done();
        }));
    }));
  });

  it('should respond 201 if create software successfully', function(done) {
      helpers.api.loginAsUser(app, user1.emails[0], password, helpers.callbacks.noErrorAnd(requestAsMember => {
        const newSoftware = {
          name: 'foo',
          category: 'bar',
          versions: ['1']
        };
        const req = requestAsMember(request(app).post('/ticketing/api/software'));

        function checkSoftwareIndexed(software) {
          const options = {
            index: INDICES.SOFTWARE.name,
            type: INDICES.SOFTWARE.type,
            ids: software.map(sw => sw._id)
          };

          return Q.nfapply(helpers.elasticsearch.checkDocumentsIndexed, [options]);
        }

        function test(created) {
          checkSoftwareIndexed(created).then(function() {
            done();
          }, done);
        }

        req.send(newSoftware);
        req.expect(201)
          .end(helpers.callbacks.noErrorAnd(res => {
            expect(res.body.name).to.equal(newSoftware.name);
            test([res.body]);
          }));
      }));
    });
});
