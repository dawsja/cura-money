/**
 * Access control for Better Auth. The admin plugin is the only role we ship
 * by default; "admin" can do anything, "user" can do normal CRUD on their
 * own rows. The guard middleware on the root app forces all app routes
 * to require an authenticated user; admin-only routes check `c.get('user').role`.
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc, userAc } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  // Domain-level permissions can be added here, e.g.:
  // transaction: ['create', 'read', 'update', 'delete'],
};

export const ac = createAccessControl(statement);

export const admin = ac.newRole({
  ...adminAc.statements,
});

export const user = ac.newRole({
  ...userAc.statements,
});
