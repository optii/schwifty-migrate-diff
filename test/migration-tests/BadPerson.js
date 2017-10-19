'use strict';

const Joi = require('joi');
const Model = require('schwifty').Model;

module.exports = class Person extends Model {

    static get tableName() {

        return 'Person';
    }

    static get joiSchema() {

        return Joi.object({
            id: Joi.number().integer(),
            firstName: Joi.string(),
            lastName: Joi.string(),

            age: Joi.number().integer(),

            // These cannot be different types, they must be the same type
            address: Joi.alternatives([
                Joi.string(),
                Joi.object()
            ])
        });
    }
};
