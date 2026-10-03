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
    address forwardee = address(0xF0F0);
    bytes32 constant ID = bytes32("WF-2026-TEMPO-03");
    uint96 constant AMOUNT = 10_000e6;
    uint64 constant MIN_TTL = 7 days;
    address constant TAX = address(0x1E5);

    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount, bytes32 memo);
    event Registered(bytes32 indexed id, address indexed recipient);

    function setUp() public {
        // TIP-20s live at 0x20c0… precompile addresses on Tempo; put the mock's code there
        MockTIP20 impl = new MockTIP20();
        vm.etch(address(0x20C0000000000000000000000000000000000001), address(impl).code);
        token = MockTIP20(address(0x20C0000000000000000000000000000000000001));
        escrow = new ClaimEscrow(organizer, MIN_TTL, TAX, 3_000, 2 days);
        claimSigner = vm.addr(claimPk);
        token.mint(organizer, 1_000_000e6);
        vm.prank(organizer);
        token.approve(address(escrow), type(uint256).max);
    }

    // ---- helpers
    function _fund(uint64 ttl) internal {
        vm.prank(organizer);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp) + ttl, claimSigner);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _regSig(address recipient) internal view returns (bytes memory) {
        return _sig(claimPk, escrow.registerDigest(ID, recipient));
    }

    function _claimSig(address recipient) internal view returns (bytes memory) {
        return _sig(claimPk, escrow.claimDigest(ID, recipient));
    }

    function _clearFor(address expected) internal {
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben+kyc"), expected, 0);
    }

    function _status() internal view returns (ClaimEscrow.Status) {
        return escrow.statusOf(ID);
    }

    // ---- funding
    function test_fund_pullsTokens() public {
        _fund(MIN_TTL);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Funded));
    }

    function test_fund_rejectsNonTip20Tokens() public {
        MockTIP20 lookalike = new MockTIP20();
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(ID, address(lookalike), AMOUNT, uint64(block.timestamp + MIN_TTL), claimSigner);
    }

    function test_fund_rejectsDuplicatesAndBadInputs() public {
        _fund(MIN_TTL);
        vm.startPrank(organizer);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + MIN_TTL), claimSigner);
        bytes32 other = bytes32("OTHER");
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(other, address(token), 0, uint64(block.timestamp + MIN_TTL), claimSigner);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(other, address(token), AMOUNT, uint64(block.timestamp + MIN_TTL - 1), claimSigner); // below the floor
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(other, address(token), AMOUNT, uint64(block.timestamp + 367 days), claimSigner);
        vm.expectRevert(ClaimEscrow.InvalidAward.selector);
        escrow.fund(other, address(token), AMOUNT, uint64(block.timestamp + MIN_TTL), address(0));
        vm.stopPrank();
    }

    // ---- path A: register early; clearing for that account pays it in the same call
    function test_pathA_register_thenClear_paysThatAccount() public {
        _fund(MIN_TTL);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit Registered(ID, winner);
        escrow.register(ID, winner, _regSig(winner));
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Registered));
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(ID, winner, AMOUNT, ID);
        _clearFor(winner);
        assertEq(token.balanceOf(winner), AMOUNT);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Claimed));
    }

    function test_forwardedLink_cannotReRegister() public {
        _fund(MIN_TTL);
        escrow.register(ID, winner, _regSig(winner));
        bytes memory sig = _regSig(forwardee); // a forwarded link signs for someone else
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.register(ID, forwardee, sig);
        bytes memory replay = _regSig(winner);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.register(ID, winner, replay); // replaying the original registration does nothing either
    }

    function test_frontRunRegistration_isCaughtByExpectedRecipient() public {
        _fund(MIN_TTL);
        escrow.register(ID, forwardee, _regSig(forwardee)); // someone with the link got there first
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.RecipientMismatch.selector);
        escrow.clear(ID, keccak256("kyc for the real winner"), winner, 0);
        // organizer reissues the link: scheduled first (the registered account gets notice), executed after the delay
        uint256 newPk = 0xBEEF;
        address newSigner = vm.addr(newPk);
        vm.prank(organizer);
        escrow.reissueLink(ID, newSigner);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Registered)); // nothing wiped yet
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.NotExpired.selector);
        escrow.reissueLink(ID, newSigner);
        vm.warp(block.timestamp + 2 days);
        vm.prank(organizer);
        escrow.reissueLink(ID, newSigner);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Funded));
        bytes memory oldKeySig = _regSig(forwardee);
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.register(ID, forwardee, oldKeySig);
        escrow.register(ID, winner, _sig(newPk, escrow.registerDigest(ID, winner)));
        _clearFor(winner);
        assertEq(token.balanceOf(winner), AMOUNT);
        assertEq(token.balanceOf(forwardee), 0);
    }

    function test_changeRecipient_onlyByTheRegisteredAccount() public {
        _fund(MIN_TTL);
        escrow.register(ID, winner, _regSig(winner));
        vm.expectRevert(ClaimEscrow.NotRecipient.selector);
        escrow.changeRecipient(ID, forwardee);
        address cold = address(0xC01D);
        vm.prank(winner);
        escrow.changeRecipient(ID, cold);
        _clearFor(cold);
        assertEq(token.balanceOf(cold), AMOUNT);
    }

    function test_clear_withholdsTaxAtSource_toTheFixedTaxAccount() public {
        _fund(MIN_TTL);
        escrow.register(ID, winner, _regSig(winner));
        uint96 tax = 3_000e6; // exactly the 30% cap
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben: no treaty"), winner, tax);
        assertEq(token.balanceOf(TAX), tax);
        assertEq(token.balanceOf(winner), AMOUNT - tax);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_withholdingAboveTheCap_reverts_cannotBecomeARedirect() public {
        _fund(MIN_TTL);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.InvalidWithholding.selector);
        escrow.clear(ID, bytes32(0), address(0), 3_000e6 + 1);
    }

    function test_deploy_rejectsUnsafeWithholdingSettings() public {
        vm.expectRevert(ClaimEscrow.InvalidWithholding.selector);
        new ClaimEscrow(organizer, MIN_TTL, TAX, 5_001, 2 days);
        vm.expectRevert(ClaimEscrow.InvalidWithholding.selector);
        new ClaimEscrow(organizer, MIN_TTL, address(0), 100, 2 days);
        ClaimEscrow none = new ClaimEscrow(organizer, MIN_TTL, address(0), 0, 2 days); // no withholding at all is fine
        assertEq(none.maxWithholdingBps(), 0);
    }

    function test_register_forgedOrCrossPurposeSignature_reverts() public {
        _fund(MIN_TTL);
        bytes memory forged = _sig(0xBAD, escrow.registerDigest(ID, winner));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.register(ID, winner, forged);
        bytes memory claimSig = _claimSig(winner); // a claim signature is not a registration
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.register(ID, winner, claimSig);
    }

    // ---- path B: nobody registered → clearance opens a bearer claim
    function test_pathB_claim_beforeClearance_reverts() public {
        _fund(MIN_TTL);
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.claim(ID, winner, sig);
    }

    function test_pathB_claim_afterClearance_pays_once() public {
        _fund(MIN_TTL);
        _clearFor(address(0));
        bytes memory sig = _claimSig(winner);
        escrow.claim(ID, winner, sig);
        assertEq(token.balanceOf(winner), AMOUNT);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.claim(ID, winner, sig);
    }

    function test_pathB_clearForSomeoneWhenNobodyRegistered_reverts() public {
        _fund(MIN_TTL);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.RecipientMismatch.selector);
        escrow.clear(ID, bytes32(0), winner, 0);
    }

    function test_pathB_redirect_highS_wrongLength_otherEscrow_revert() public {
        ClaimEscrow other = new ClaimEscrow(organizer, MIN_TTL, TAX, 3_000, 2 days);
        _fund(MIN_TTL);
        _clearFor(address(0));
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, forwardee, sig);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPk, escrow.claimDigest(ID, winner));
        bytes32 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(uint256(n) - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, winner, flipped);
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, winner, hex"1234");
        bytes memory forOther = _sig(claimPk, other.claimDigest(ID, winner));
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, winner, forOther);
    }

    // ---- organizer commitment
    function test_reissue_ofAnUnregisteredAward_isImmediate() public {
        _fund(MIN_TTL);
        address s2 = vm.addr(0xBEEF);
        vm.prank(organizer);
        escrow.reissueLink(ID, s2);
        escrow.register(ID, winner, _sig(0xBEEF, escrow.registerDigest(ID, winner)));
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Registered));
    }

    function test_bearerClearNearExpiry_extendsTheWindow_soItCannotBeReclaimed() public {
        _fund(MIN_TTL);
        vm.warp(block.timestamp + MIN_TTL - 1); // one second before expiry
        _clearFor(address(0));
        vm.warp(block.timestamp + 2);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.NotExpired.selector);
        escrow.reclaim(ID);
        escrow.claim(ID, winner, _claimSig(winner));
        assertEq(token.balanceOf(winner), AMOUNT);
    }

    function test_afterClearance_organizerCannotRevokeOrReissue() public {
        _fund(MIN_TTL);
        _clearFor(address(0));
        vm.startPrank(organizer);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.revoke(ID);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.reissueLink(ID, organizer);
        vm.stopPrank();
    }

    function test_revoke_beforeClearance_refundsNow_linkDead() public {
        _fund(MIN_TTL);
        escrow.register(ID, winner, _regSig(winner));
        uint256 before = token.balanceOf(organizer);
        vm.prank(organizer);
        escrow.revoke(ID);
        assertEq(token.balanceOf(organizer), before + AMOUNT);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Revoked));
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.WrongState.selector);
        escrow.clear(ID, bytes32(0), winner, 0);
    }

    // ---- expiry
    function test_expiry_atExactSecond_blocksClaim_allowsReclaim() public {
        _fund(MIN_TTL);
        _clearFor(address(0));
        vm.warp(block.timestamp + MIN_TTL);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Expired));
        bytes memory sig = _claimSig(winner);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.claim(ID, winner, sig);
        vm.prank(organizer);
        escrow.reclaim(ID);
        assertEq(uint8(_status()), uint8(ClaimEscrow.Status.Reclaimed));
    }

    function test_reclaim_beforeExpiry_reverts() public {
        _fund(MIN_TTL);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.NotExpired.selector);
        escrow.reclaim(ID);
    }

    function test_clear_afterExpiry_reverts() public {
        _fund(MIN_TTL);
        vm.warp(block.timestamp + MIN_TTL);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.clear(ID, bytes32(0), address(0), 0);
    }

    // ---- roles
    function test_onlyOrganizer() public {
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + MIN_TTL), claimSigner);
        _fund(MIN_TTL);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.clear(ID, bytes32(0), address(0), 0);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.revoke(ID);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.reissueLink(ID, address(1));
        vm.warp(block.timestamp + MIN_TTL);
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

    function test_unknownAward_reverts() public {
        vm.expectRevert(ClaimEscrow.UnknownAward.selector);
        escrow.claim(bytes32("nope"), winner, hex"00");
    }

    // ---- invariant (fuzz): every funded dollar ends in exactly one place, and the escrow ends empty
    function testFuzz_conservation(uint96 amount, uint8 path, uint96 taxBps) public {
        amount = uint96(bound(amount, 2, 1_000_000e6));
        uint96 tax = uint96((uint256(amount) * bound(taxBps, 0, 3_000)) / 10_000);
        address taxAccount = TAX;
        vm.prank(organizer);
        escrow.fund(ID, address(token), amount, uint64(block.timestamp + MIN_TTL), claimSigner);
        uint256 total = token.balanceOf(organizer) + token.balanceOf(address(escrow));
        uint8 p = path % 4;
        if (p == 0) {
            escrow.register(ID, winner, _regSig(winner));
            vm.prank(organizer);
            escrow.clear(ID, bytes32(0), winner, tax);
        } else if (p == 1) {
            vm.prank(organizer);
            escrow.clear(ID, bytes32(0), address(0), tax);
            escrow.claim(ID, winner, _claimSig(winner));
        } else if (p == 2) {
            vm.prank(organizer);
            escrow.revoke(ID);
        } else {
            vm.warp(block.timestamp + MIN_TTL);
            vm.prank(organizer);
            escrow.reclaim(ID);
        }
        assertEq(token.balanceOf(organizer) + token.balanceOf(winner) + token.balanceOf(taxAccount), total);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}
