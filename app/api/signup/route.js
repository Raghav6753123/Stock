import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import getConnection from '../lib/mysql';
import sgMail from '@sendgrid/mail';
import { ensureUsersTable, ensurePasswordHashColumn, ensureRefreshTokenColumns, ensureEmailVerifiedColumn } from '../lib/userSchema';
import { isTrustedOrigin } from '../lib/requestSecurity';

export async function POST(req) {
  try {
    if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing name, email, or password' }, { status: 400 });
    }

    if (name.length > 120 || email.length > 254) {
      return NextResponse.json({ error: 'Invalid input length' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const conn = await getConnection();
    try {
      const usersTable = await ensureUsersTable(conn);
      if (!usersTable.ok) {
        return NextResponse.json({ error: usersTable.error }, { status: 500 });
      }

      const schema = await ensurePasswordHashColumn(conn);
      if (!schema.ok) {
        return NextResponse.json({ error: schema.error }, { status: 500 });
      }
      const refreshSchema = await ensureRefreshTokenColumns(conn);
      if (!refreshSchema.ok) {
        return NextResponse.json({ error: refreshSchema.error }, { status: 500 });
      }
      const verifiedSchema = await ensureEmailVerifiedColumn(conn);
      if (!verifiedSchema.ok) return NextResponse.json({ error: verifiedSchema.error }, { status: 500 });
      if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
        return NextResponse.json({ error: 'Email verification is not configured.' }, { status: 500 });
      }

      const [rows] = await conn.query(
        'SELECT id, name, email, password_hash FROM users WHERE email = ? LIMIT 1',
        [email]
      );

      if (rows && rows.length > 0) {
        return NextResponse.json({ error: 'Email is already in use' }, { status: 409 });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const [result] = await conn.query(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
        [name, email, passwordHash]
      );

      const [createdRows] = await conn.query(
        'SELECT id, name, email FROM users WHERE id = ? LIMIT 1',
        [result.insertId]
      );

      const user = createdRows?.[0] || null;
      if (!user) {
        return NextResponse.json({ error: 'User creation failed' }, { status: 500 });
      }

      await conn.query(`CREATE TABLE IF NOT EXISTS email_verifications (
        token CHAR(36) NOT NULL PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
        expires_at DATETIME NOT NULL, used_at DATETIME NULL,
        CONSTRAINT fk_email_verification_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const token = crypto.randomUUID();
      await conn.query(
        'INSERT INTO email_verifications (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR))',
        [token, user.id]
      );
      const link = `${process.env.APP_URL || req.nextUrl.origin}/auth/verify-email?token=${encodeURIComponent(token)}`;
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to: user.email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Verify your Trade-karo account email',
        text: `Verify your account within 24 hours: ${link}`,
        html: `<p>Welcome to Trade-karo.</p><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
      });
      return NextResponse.json({ message: 'Verification email sent. Open it before signing in.' }, { status: 201 });
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Signup failed:', error);
    const message = process.env.NODE_ENV === 'production'
      ? 'Signup failed'
      : (error instanceof Error ? error.message : 'Signup failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
