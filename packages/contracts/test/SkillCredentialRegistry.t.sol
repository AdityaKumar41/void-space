// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SkillCredentialRegistry.sol";

contract SkillCredentialRegistryTest is Test {
    SkillCredentialRegistry registry;
    address learner = address(0x1234);

    function setUp() public {
        registry = new SkillCredentialRegistry();
    }

    function test_RetryKeepsOneTokenAndOneBalance() public {
        uint256 first = registry.mintCredential(learner, "credential", "proof", "lesson");
        vm.warp(block.timestamp + 30);
        uint256 again = registry.mintCredential(learner, "credential", "proof", "lesson");
        assertEq(first, again);
        assertEq(registry.balanceOf(learner), 1);
        assertEq(registry.ownerOf(first), learner);
    }

    function test_RejectsChangedEvidenceForSameCredential() public {
        registry.mintCredential(learner, "credential", "proof", "lesson");
        vm.expectRevert("credential mismatch");
        registry.mintCredential(learner, "credential", "changed", "lesson");
    }

    function test_CannotRemintRevokedCredential() public {
        uint256 id = registry.mintCredential(learner, "credential", "proof", "lesson");
        registry.revokeCredential(id);
        vm.expectRevert("credential revoked");
        registry.mintCredential(learner, "credential", "proof", "lesson");
        assertTrue(registry.getCredential(id).revoked);
    }

    function test_OnlyAuthorizedPublisherCanMint() public {
        vm.prank(learner);
        vm.expectRevert("not publisher");
        registry.mintCredential(learner, "credential", "proof", "lesson");
    }
}
