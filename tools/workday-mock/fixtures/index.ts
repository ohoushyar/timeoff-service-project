export const WORKERS = [
  {
    id: 'worker-bob-wid',
    descriptor: 'Bob Manager',
    email: 'bob.manager@example.com',
    department: { descriptor: 'Engineering' },
    employmentStatus: 'Active',
  },
  {
    id: 'worker-alice-wid',
    descriptor: 'Alice Employee',
    email: 'alice.employee@example.com',
    manager: { id: 'worker-bob-wid' },
    department: { descriptor: 'Engineering' },
    employmentStatus: 'Active',
  },
  {
    id: 'worker-carol-wid',
    descriptor: 'Carol HR',
    email: 'carol.hr@example.com',
    department: { descriptor: 'HR' },
    employmentStatus: 'Active',
  },
];

export const LEAVE_TYPES = [
  {
    id: 'leave-vacation-wid',
    descriptor: 'Vacation',
    paid: true,
    requiresApproval: true,
  },
  {
    id: 'leave-sick-wid',
    descriptor: 'Sick Leave',
    paid: true,
    requiresApproval: true,
  },
];

export const BALANCES: Record<string, Array<{
  absencePlan: { id: string; descriptor: string };
  quantity: string;
  unit: { descriptor: string };
  position?: { location?: { id: string } };
}>> = {
  'worker-alice-wid': [
    {
      absencePlan: { id: 'leave-vacation-wid', descriptor: 'Vacation' },
      quantity: '10',
      unit: { descriptor: 'Days' },
      position: { location: { id: 'US-NY' } },
    },
    {
      absencePlan: { id: 'leave-sick-wid', descriptor: 'Sick Leave' },
      quantity: '5',
      unit: { descriptor: 'Days' },
      position: { location: { id: 'US-NY' } },
    },
  ],
  'worker-bob-wid': [
    {
      absencePlan: { id: 'leave-vacation-wid', descriptor: 'Vacation' },
      quantity: '15',
      unit: { descriptor: 'Days' },
      position: { location: { id: 'US-NY' } },
    },
  ],
  'worker-carol-wid': [
    {
      absencePlan: { id: 'leave-vacation-wid', descriptor: 'Vacation' },
      quantity: '12',
      unit: { descriptor: 'Days' },
      position: { location: { id: 'US-NY' } },
    },
  ],
};
