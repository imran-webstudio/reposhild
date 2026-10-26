export interface AdminUser {
  id: string;
  githubId: string | null;
  login: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  _count: { scans: number; remediations: number; activities: number };
}
export interface AdminActivity {
  id: string;
  action: string;
  outcome: string;
  target: string | null;
  createdAt: string;
  user: { id: string; login: string; name: string | null; githubId: string | null };
}
export interface AdminData {
  overview: { users: number; activeUsers: number; scans: number; cleanups: number };
  users: AdminUser[];
  activities: AdminActivity[];
  total: number;
  page: number;
  pageSize: number;
  refreshedAt: string;
}
