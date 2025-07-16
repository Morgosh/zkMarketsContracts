# Development Rules

## Test-Driven Development
- Write tests first, then implement functionality
- All public functions must have corresponding tests
- Tests must cover edge cases and error conditions
- Use descriptive test names and organize by feature

## Code Quality
- Follow Solidity best practices
- Use clear, descriptive variable names
- Add comments for complex logic
- Keep functions small and focused

## Testing Standards
- Test file naming: `ContractName.test.ts`
- Group tests by functionality using `describe` blocks
- Use `beforeEach` for setup
- Test both success and failure cases
- Mock external dependencies (Chainlink oracles)

## Git Workflow
- Commit tests first, then implementation
- Use descriptive commit messages
- One feature per branch/PR 