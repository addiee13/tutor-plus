/** PostgreSQL SQLSTATE codes raised by the schema's functions and constraints. */
export const PgErrorCode = {
  insufficientPrivilege: "42501",
  exclusionViolation: "23P01",
  uniqueViolation: "23505",
  invalidParameterValue: "22023",
} as const;
