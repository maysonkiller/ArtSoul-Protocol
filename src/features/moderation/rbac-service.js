import crypto from 'crypto';

class RBACService {
    constructor(database) {
        this.db = database;
        console.log('[RBACService] Initialized');
    }

    async hasPermission(userId, permissionId) {
        const result = await this.db.query(
            `SELECT 1 FROM user_roles ur
             JOIN role_permissions rp ON ur.role_id = rp.role_id
             WHERE ur.user_id = ?
             AND rp.permission_id = ?
             AND (ur.expires_at IS NULL OR ur.expires_at > ?)
             LIMIT 1`,
            [userId, permissionId, Date.now()]
        );

        return result.length > 0;
    }

    async getUserRoles(userId) {
        const roles = await this.db.query(
            `SELECT r.id, r.name, r.description, ur.assigned_at, ur.expires_at
             FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.user_id = ?
             AND (ur.expires_at IS NULL OR ur.expires_at > ?)`,
            [userId, Date.now()]
        );

        return roles;
    }

    async getUserPermissions(userId) {
        const permissions = await this.db.query(
            `SELECT DISTINCT p.id, p.resource, p.action, p.description
             FROM user_roles ur
             JOIN role_permissions rp ON ur.role_id = rp.role_id
             JOIN permissions p ON rp.permission_id = p.id
             WHERE ur.user_id = ?
             AND (ur.expires_at IS NULL OR ur.expires_at > ?)`,
            [userId, Date.now()]
        );

        return permissions;
    }

    async assignRole(userId, roleId, assignedBy, expiresAt = null) {
        const canAssign = await this.hasPermission(assignedBy, 'PERM_ROLE_ASSIGN');

        if (!canAssign) {
            throw new Error('Insufficient permissions to assign roles');
        }

        const now = Date.now();

        await this.db.query(
            `INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             assigned_by = VALUES(assigned_by),
             assigned_at = VALUES(assigned_at),
             expires_at = VALUES(expires_at)`,
            [userId, roleId, assignedBy, now, expiresAt]
        );

        console.log(`[RBACService] Role ${roleId} assigned to user ${userId} by ${assignedBy}`);

        return {
            success: true,
            userId,
            roleId,
            assignedBy,
            assignedAt: now,
            expiresAt
        };
    }

    async revokeRole(userId, roleId, revokedBy) {
        const canRevoke = await this.hasPermission(revokedBy, 'PERM_ROLE_REVOKE');

        if (!canRevoke) {
            throw new Error('Insufficient permissions to revoke roles');
        }

        await this.db.query(
            `DELETE FROM user_roles
             WHERE user_id = ? AND role_id = ?`,
            [userId, roleId]
        );

        console.log(`[RBACService] Role ${roleId} revoked from user ${userId} by ${revokedBy}`);

        return {
            success: true,
            userId,
            roleId,
            revokedBy,
            revokedAt: Date.now()
        };
    }

    async canPerformAction(userId, resource, action, context = {}) {
        const permissionId = `PERM_${resource.toUpperCase()}_${action.toUpperCase()}`;
        const hasBasicPermission = await this.hasPermission(userId, permissionId);

        if (!hasBasicPermission) {
            return {
                allowed: false,
                reason: 'Missing required permission'
            };
        }

        const roles = await this.getUserRoles(userId);
        const isDMCAAgent = roles.some(role => role.id === 'ROLE_DMCA_AGENT');

        if (isDMCAAgent && action === 'hide') {
            if (!context.reason) {
                return {
                    allowed: false,
                    reason: 'DMCA agents must provide a reason'
                };
            }

            const allowedReasons = await this.db.query(
                'SELECT reason_code FROM dmca_allowed_reasons'
            );

            const reasonCodes = allowedReasons.map(r => r.reason_code);
            const reasonUpper = context.reason.toUpperCase();
            const isValidReason = reasonCodes.some(code => reasonUpper.includes(code));

            if (!isValidReason) {
                return {
                    allowed: false,
                    reason: `DMCA agents can only hide for copyright reasons: ${reasonCodes.join(', ')}`
                };
            }
        }

        return {
            allowed: true
        };
    }

    async getRolePermissions(roleId) {
        const permissions = await this.db.query(
            `SELECT p.id, p.resource, p.action, p.description
             FROM role_permissions rp
             JOIN permissions p ON rp.permission_id = p.id
             WHERE rp.role_id = ?`,
            [roleId]
        );

        return permissions;
    }

    async getAllRoles() {
        const roles = await this.db.query(
            'SELECT id, name, description FROM roles ORDER BY name'
        );

        return roles;
    }

    async getAllPermissions() {
        const permissions = await this.db.query(
            'SELECT id, resource, action, description FROM permissions ORDER BY resource, action'
        );

        return permissions;
    }

    async getUsersWithRole(roleId) {
        const users = await this.db.query(
            `SELECT user_id, assigned_by, assigned_at, expires_at
             FROM user_roles
             WHERE role_id = ?
             AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY assigned_at DESC`,
            [roleId, Date.now()]
        );

        return users;
    }
}

export default RBACService;

if (typeof window !== 'undefined') {
    window.RBACService = RBACService;
}
