import { describe, expect, it } from 'vitest';
import { applyEgg, EMPTY_FORM, payloadFromForm } from './form';
import type { Options } from '../api';

const options: Options = {
    eggs: [
        {
            id: 1,
            name: 'A',
            images: ['img-a'],
            startup: null,
            variables: [{ env: 'X', name: 'X', default: null, rules: '' }],
        },
        {
            id: 2,
            name: 'B',
            images: ['img-b1', 'img-b2'],
            startup: null,
            variables: [{ env: 'Y', name: 'Y', default: null, rules: '' }],
        },
    ],
    nodes: [],
    locations: [],
    users: [],
};

describe('template form', () => {
    it('sends nulls for empty optional numbers and trims text', () => {
        const body = payloadFromForm({
            ...EMPTY_FORM,
            name: '  Lobby  ',
            description: '  ',
            max_instances: '',
            database_limit: '',
            egg_id: 1,
        });
        expect(body.name).toBe('Lobby');
        expect(body.description).toBeNull();
        expect(body.max_instances).toBeNull();
        expect(body.database_limit).toBeNull();
        expect(body.memory).toBe(1024);
    });

    it('only sends placement fields that belong to the chosen mode', () => {
        const fixed = payloadFromForm({
            ...EMPTY_FORM,
            placement_mode: 'fixed_node',
            node_id: 4,
            allowed_nodes: [1, 2],
        });
        expect(fixed.node_id).toBe(4);
        expect(fixed.allowed_nodes).toEqual([]);
        const allowed = payloadFromForm({
            ...EMPTY_FORM,
            placement_mode: 'allowed_nodes',
            node_id: 4,
            allowed_nodes: [1, 2],
        });
        expect(allowed.node_id).toBeNull();
        expect(allowed.allowed_nodes).toEqual([1, 2]);
    });

    it('only sends a time to live for temporary templates', () => {
        expect(payloadFromForm({ ...EMPTY_FORM, temporary: false, ttl_minutes: '30' }).ttl_minutes).toBeNull();
        expect(payloadFromForm({ ...EMPTY_FORM, temporary: true, ttl_minutes: '30' }).ttl_minutes).toBe(30);
    });

    it('switching software drops unknown variables and invalid images', () => {
        const form = {
            ...EMPTY_FORM,
            egg_id: 1,
            docker_image: 'img-a',
            variables: { X: { value: '1', overridable: false } },
        };
        const next = applyEgg(form, 2, options);
        expect(next.variables).toEqual({});
        expect(next.docker_image).toBe('img-b1');
        expect(applyEgg({ ...form, docker_image: 'img-b2' }, 2, options).docker_image).toBe('img-b2');
        expect(applyEgg(form, 1, options).variables).toEqual(form.variables);
    });
});
