// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimEscrow} from "../ClaimEscrow.sol";
import {MockTIP20} from "./MockTIP20.sol";

contract ClaimEscrowTest is Test {
    ClaimEscrow escrow;
    MockTIP20 token;
    address organizer = address(0xA11CE);
    uint256 claimPk = 0xC1A1;
    address claimSigner;
    address winner = address(0xB0B);
    bytes32 constant ID = bytes32("WF-2026-TEMPO-03");
    bytes32 constant MEMO = bytes32("WF-2026-TEMPO-03");
    uint96 constant AMOUNT = 10_000e6;

    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount, bytes32 memo);
    event Registered(bytes32 indexed id, address indexed recipient);

    function setUp() public {
        token = new MockTIP20();
        escrow = new ClaimEscrow(organizer);
        claimSigner = vm.addr(claimPk);
        token.mint(organizer, 1_000_000e6);
        vm.prank(organizer);
        token.approve(address(escrow), type(uint256).max);
    }

    function _fund(uint64 ttl) internal {
        vm.prank(organizer);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp) + ttl, claimSigner);
    }

    function _clear() internal {
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben+kyc"));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claimSig(address recipient) internal view returns (bytes memory) {
        return _sig(claimPk, escrow.claimDigest(ID, recipient));
    }

    function _registerSig(address recipient) internal view returns (bytes memory) {
        return _sig(claimPk, escrow.registerDigest(ID, recipient));
    }

    // ---- funding
    function test_fund_pullsTokensIntoEscrow() public {
        _fund(1 days);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Funded));
    }

    function test_fund_sameIdTwice_reverts() public {
        _fund(1 days);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.AlreadyExists.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + 1 days), claimSigner);
    }

    function test_fund_invalidInputs_revert() public {
        vm.startPrank(organizer);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(ID, address(token), 0, uint64(block.timestamp + 1 days), claimSigner);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp), claimSigner);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + 1 days), address(0));
        vm.stopPrank();
    }

    // ---- path A: winner registers an account early; clearing the paperwork pays that account
    function test_register_thenClear_paysRegisteredAccount() public {
        _fund(1 days);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit Registered(ID, winner);
        escrow.register(ID, winner, _registerSig(winner));
        assertEq(escrow.awardOf(ID).recipient, winner);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(ID, winner, AMOUNT, MEMO);
        _clear();
        assertEq(token.balanceOf(winner), AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Claimed));
    }

    function test_register_withForgedSignature_reverts() public {
        _fund(1 days);
        bytes memory sig = _sig(0xBAD, escrow.registerDigest(ID, winner));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.register(ID, winner, sig);
    }

    function test_register_claimSignatureCannotBeReusedAsRegistration() public {
        _fund(1 days);
        bytes memory claimSig = _claimSig(winner); // different domain tag
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.register(ID, winner, claimSig);
    }

    function test_register_canBeChangedUntilCleared() public {
        _fund(1 days);
        escrow.register(ID, address(0x1111), _registerSig(address(0x1111)));
        escrow.register(ID, winner, _registerSig(winner));
        _clear();
        assertEq(token.balanceOf(winner), AMOUNT);
        assertEq(token.balanceOf(address(0x1111)), 0);
    }

    // ---- path B: no registration → clearance opens a bearer claim (AC-3..AC-6)
    function test_claim_beforeClearance_reverts() public {
        _fund(1 days);
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.NotCleared.selector);
        escrow.claim(ID, winner, sig);
    }

    function test_claim_afterClearance_paysWithMemo() public {
        _fund(1 days);
        _clear();
        bytes memory sig = _claimSig(winner);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(ID, winner, AMOUNT, MEMO);
        escrow.claim(ID, winner, sig);
        assertEq(token.balanceOf(winner), AMOUNT);
    }

    function test_claim_twice_reverts() public {
        _fund(1 days);
        _clear();
        bytes memory sig = _claimSig(winner);
        escrow.claim(ID, winner, sig);
        vm.expectRevert(ClaimEscrow.AlreadySettled.selector);
        escrow.claim(ID, winner, sig);
    }

    function test_claim_redirectedRecipient_reverts() public {
        _fund(1 days);
        _clear();
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, address(0xBAD), sig);
    }

    function test_claim_highS_malleableSignature_reverts() public {
        _fund(1 days);
        _clear();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPk, escrow.claimDigest(ID, winner));
        bytes32 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(uint256(n) - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, winner, flipped);
    }

    function test_claim_signatureForAnotherEscrow_reverts() public {
        ClaimEscrow other = new ClaimEscrow(organizer);
        _fund(1 days);
        _clear();
        bytes memory sigForOther = _sig(claimPk, other.claimDigest(ID, winner));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, winner, sigForOther);
    }

    // ---- expiry, revoke, rotate (AC-7, AC-11, AC-12)
    function test_expired_claimReverts_organizerReclaims() public {
        _fund(1 hours);
        _clear();
        vm.warp(block.timestamp + 2 hours);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Expired));
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.claim(ID, winner, sig);
        uint256 before = token.balanceOf(organizer);
        vm.prank(organizer);
        escrow.reclaim(ID);
        assertEq(token.balanceOf(organizer), before + AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Reclaimed));
    }

    function test_reclaim_beforeExpiry_reverts() public {
        _fund(1 days);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.NotExpired.selector);
        escrow.reclaim(ID);
    }

    function test_revoke_beforeClearance_returnsFunds() public {
        _fund(1 days);
        uint256 before = token.balanceOf(organizer);
        vm.prank(organizer);
        escrow.revoke(ID);
        assertEq(token.balanceOf(organizer), before + AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Revoked));
        bytes memory sig = _registerSig(winner);
        vm.expectRevert(ClaimEscrow.AlreadySettled.selector);
        escrow.register(ID, winner, sig);
    }

    function test_revoke_afterClearance_reverts_commitmentHolds() public {
        _fund(1 days);
        _clear();
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.AlreadyCleared.selector);
        escrow.revoke(ID);
    }

    function test_rotateSigner_killsLeakedLink() public {
        _fund(1 days);
        uint256 newPk = 0xBEEF;
        vm.prank(organizer);
        escrow.rotateSigner(ID, vm.addr(newPk));
        bytes memory oldSig = _registerSig(winner);
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.register(ID, winner, oldSig);
        escrow.register(ID, winner, _sig(newPk, escrow.registerDigest(ID, winner)));
        assertEq(escrow.awardOf(ID).recipient, winner);
    }

    function test_expiryBoundary_atExactSecond() public {
        _fund(1 hours);
        _clear();
        vm.warp(block.timestamp + 1 hours); // == expiresAt
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.claim(ID, winner, sig);
        vm.prank(organizer);
        escrow.reclaim(ID); // allowed from the same second
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Reclaimed));
    }

    function test_fund_ttlAboveMax_reverts() public {
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + 367 days), claimSigner);
    }

    function test_claim_wrongLengthOrZeroRecipient_reverts() public {
        _fund(1 days);
        _clear();
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, winner, hex"1234");
        bytes memory sig = _claimSig(address(0));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, address(0), sig);
    }

    function test_claim_whenRecipientRegistered_isNotNeeded_clearPaid() public {
        _fund(1 days);
        escrow.register(ID, winner, _registerSig(winner));
        _clear();
        bytes memory sig = _claimSig(address(0xBAD));
        vm.expectRevert(ClaimEscrow.AlreadySettled.selector);
        escrow.claim(ID, address(0xBAD), sig);
    }

    // ---- roles
    function test_onlyOrganizer_canFundClearRevokeRotateReclaim() public {
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + 1 days), claimSigner);
        _fund(1 days);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.clear(ID, bytes32(0));
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.revoke(ID);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.rotateSigner(ID, address(1));
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.reclaim(ID);
    }

    function test_organizerRole_twoStepTransfer() public {
        address next = address(0x5AFE);
        vm.prank(organizer);
        escrow.proposeOrganizer(next);
        assertEq(escrow.organizer(), organizer);
        vm.prank(next);
        escrow.acceptOrganizer();
        assertEq(escrow.organizer(), next);
    }

    function test_claim_unknownAward_reverts() public {
        vm.expectRevert(ClaimEscrow.UnknownAward.selector);
        escrow.claim(bytes32("nope"), winner, hex"00");
    }

    function test_clear_afterExpiry_reverts() public {
        _fund(1 hours);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.clear(ID, bytes32(0));
    }

    // ---- accounting invariant (fuzz): every funded dollar ends in exactly one place
    function testFuzz_conservation(uint96 amount, uint8 path) public {
        amount = uint96(bound(amount, 1, 1_000_000e6));
        vm.prank(organizer);
        escrow.fund(ID, address(token), amount, uint64(block.timestamp + 1 days), claimSigner);
        uint256 total = token.balanceOf(organizer) + token.balanceOf(address(escrow)) + token.balanceOf(winner);
        uint8 p = path % 4;
        if (p == 0) { escrow.register(ID, winner, _registerSig(winner)); _clear(); }
        else if (p == 1) { _clear(); escrow.claim(ID, winner, _claimSig(winner)); }
        else if (p == 2) { vm.prank(organizer); escrow.revoke(ID); }
        else { vm.warp(block.timestamp + 2 days); vm.prank(organizer); escrow.reclaim(ID); }
        assertEq(token.balanceOf(organizer) + token.balanceOf(address(escrow)) + token.balanceOf(winner), total);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}
