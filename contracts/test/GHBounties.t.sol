// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GHBounties} from "../src/GHBounties.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract GHBountiesTest is Test {
    GHBounties internal bounties;
    MockERC20 internal usdc;

    uint256 internal payoutSignerKey = 0xA11CE;
    address internal payoutSigner;
    address internal dao = address(0xDA0);

    address internal maintainer = address(0xA11CE);
    address internal funder1 = address(0xB0B);
    address internal funder2 = address(0xCAFE);
    address internal dev = address(0xD3);

    bytes32 internal repoHash = keccak256("github.com/commaai/openpilot");
    uint256 internal issueNumber = 123;

    function setUp() public {
        payoutSigner = vm.addr(payoutSignerKey);
        bounties = new GHBounties(7 days, payoutSigner, dao, uint64(30 days));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vm.deal(maintainer, 100 ether);
        vm.deal(funder1, 100 ether);
        vm.deal(funder2, 100 ether);
        vm.deal(dev, 100 ether);

        usdc.mint(funder1, 1_000_000_000); // 1,000 USDC (6 decimals)
        usdc.mint(funder2, 1_000_000_000);
    }

    function _signPayout(
        bytes32 bountyId,
        address token,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 typeHash =
            keccak256("Payout(bytes32 bountyId,address token,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typeHash, bountyId, token, recipient, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bounties.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payoutSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signClaim(
        bytes32 bountyId,
        address claimer,
        bytes32 claimHash,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 typeHash =
            keccak256("Claim(bytes32 bountyId,address claimer,bytes32 claimHash,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typeHash, bountyId, claimer, claimHash, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bounties.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payoutSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_Flow_Fund_Claim_Payout() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "ipfs://issue-metadata");

        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 0);

        vm.prank(funder2);
        bounties.fundBountyETH{value: 2 ether}(bountyId, 0);

        assertEq(address(bounties).balance, 3 ether);
        (uint256 esc, uint256 funded, uint256 paid) = bounties.getTotals(bountyId, address(0));
        assertEq(esc, 3 ether);
        assertEq(funded, 3 ether);
        assertEq(paid, 0);

        string memory prUrl = "https://github.com/commaai/openpilot/pull/999";
        bytes32 claimHash = keccak256(bytes(prUrl));
        uint256 claimNonce = bounties.claimNonces(bountyId, dev);
        uint256 claimDeadline = block.timestamp + 1 days;
        bytes memory claimSig = _signClaim(bountyId, dev, claimHash, claimNonce, claimDeadline);

        vm.prank(dev);
        uint256 claimId = bounties.submitClaimWithAuthorization(bountyId, prUrl, claimNonce, claimDeadline, claimSig);
        (address claimer,, string memory uri) = bounties.claims(bountyId, claimId);
        assertEq(claimer, dev);
        assertEq(uri, prUrl);

        uint256 devBefore = dev.balance;

        uint256 nonce = bounties.payoutNonces(bountyId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(bountyId, address(0), dev, 3 ether, nonce, deadline);
        bounties.payoutWithAuthorization(bountyId, address(0), payable(dev), 3 ether, nonce, deadline, sig);

        assertEq(dev.balance, devBefore + 3 ether);
        (esc, funded, paid) = bounties.getTotals(bountyId, address(0));
        assertEq(esc, 0);
        assertEq(paid, 3 ether);
    }

    function test_SubmitClaimWithAuthorization() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "ipfs://issue-metadata");
        string memory prUrl = "https://github.com/commaai/openpilot/pull/123";
        bytes32 claimHash = keccak256(bytes(prUrl));
        uint256 nonce = bounties.claimNonces(bountyId, dev);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signClaim(bountyId, dev, claimHash, nonce, deadline);

        vm.prank(dev);
        uint256 claimId = bounties.submitClaimWithAuthorization(bountyId, prUrl, nonce, deadline, sig);
        (address claimer,, string memory uri) = bounties.claims(bountyId, claimId);
        assertEq(claimer, dev);
        assertEq(uri, prUrl);
    }

    function test_WithdrawAfterTimeout_OnlyIfNoPayout() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "");

        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 7 days);

        // Too early.
        vm.expectRevert(GHBounties.RefundNotAvailable.selector);
        vm.prank(funder1);
        bounties.withdrawAfterTimeout(bountyId, address(0));

        // After timeout, funder can withdraw.
        vm.warp(block.timestamp + 8 days);
        uint256 before = funder1.balance;
        vm.prank(funder1);
        bounties.withdrawAfterTimeout(bountyId, address(0));
        assertEq(funder1.balance, before + 1 ether);
    }

    function test_WithdrawAfterTimeout_BlockedIfPaid() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "");

        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 7 days);

        uint256 nonce = bounties.payoutNonces(bountyId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(bountyId, address(0), dev, 0.5 ether, nonce, deadline);
        bounties.payoutWithAuthorization(bountyId, address(0), payable(dev), 0.5 ether, nonce, deadline, sig);

        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(GHBounties.RefundNotAvailable.selector);
        vm.prank(funder1);
        bounties.withdrawAfterTimeout(bountyId, address(0));
    }

    function test_Fund_USDC_TracksTotalsAndLock() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "");

        vm.startPrank(funder1);
        usdc.approve(address(bounties), 50_000_000); // 50 USDC
        bounties.fundBountyToken(bountyId, address(usdc), 50_000_000, 10 days);
        vm.stopPrank();

        (uint256 esc, uint256 funded, uint256 paid) = bounties.getTotals(bountyId, address(usdc));
        assertEq(esc, 50_000_000);
        assertEq(funded, 50_000_000);
        assertEq(paid, 0);

        (uint256 contrib, uint64 until) = bounties.getContribution(bountyId, address(usdc), funder1);
        assertEq(contrib, 50_000_000);
        assertGe(until, uint64(block.timestamp + 10 days));
    }

    function test_Lock_ExtendsToMax() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "");

        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 10 days);
        (, uint64 until1) = bounties.getContribution(bountyId, address(0), funder1);

        vm.warp(block.timestamp + 1 days);
        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 2 days);
        (, uint64 until2) = bounties.getContribution(bountyId, address(0), funder1);

        assertEq(until2, until1); // second fund should not shorten lock
    }

    function test_PayoutWithAuthorization_ReplayReverts() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "https://github.com/seichris/gh-bounties/issues/1");
        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 0);

        uint256 nonce = bounties.payoutNonces(bountyId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(bountyId, address(0), dev, 0.5 ether, nonce, deadline);
        bounties.payoutWithAuthorization(bountyId, address(0), payable(dev), 0.5 ether, nonce, deadline, sig);

        // Reusing the same authorization should fail due to nonce mismatch.
        vm.expectRevert(GHBounties.InvalidNonce.selector);
        bounties.payoutWithAuthorization(bountyId, address(0), payable(dev), 0.5 ether, nonce, deadline, sig);
    }

    function test_PayoutWithAuthorization_ExpiredReverts() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "https://github.com/seichris/gh-bounties/issues/1");
        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 0);

        uint256 nonce = bounties.payoutNonces(bountyId);
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _signPayout(bountyId, address(0), dev, 0.1 ether, nonce, deadline);
        vm.expectRevert(GHBounties.SignatureExpired.selector);
        bounties.payoutWithAuthorization(bountyId, address(0), payable(dev), 0.1 ether, nonce, deadline, sig);
    }

    function test_DaoPayout_AfterDelay() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "https://github.com/seichris/gh-bounties/issues/1");
        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 0);

        // Too early.
        vm.expectRevert(GHBounties.DaoNotAvailable.selector);
        vm.prank(dao);
        bounties.daoPayout(bountyId, address(0), payable(dev), 0.25 ether);

        vm.warp(block.timestamp + 31 days);
        uint256 before = dev.balance;
        vm.prank(dao);
        bounties.daoPayout(bountyId, address(0), payable(dev), 0.25 ether);
        assertEq(dev.balance, before + 0.25 ether);
    }

    function test_FunderPayout_AllowsOtherFunderWithdrawAfterTimeout() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "https://github.com/seichris/gh-bounties/issues/1");

        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 0);

        vm.prank(funder2);
        bounties.fundBountyETH{value: 2 ether}(bountyId, 7 days);

        uint256 devBefore = dev.balance;
        vm.prank(funder1);
        bounties.funderPayout(bountyId, address(0), payable(dev), 1 ether);
        assertEq(dev.balance, devBefore + 1 ether);

        vm.warp(block.timestamp + 8 days);
        uint256 funder2Before = funder2.balance;
        vm.prank(funder2);
        bounties.withdrawAfterTimeout(bountyId, address(0));
        assertEq(funder2.balance, funder2Before + 2 ether);
    }

    function test_FunderPayout_RevertsIfBackendPayoutHappened() public {
        bytes32 bountyId = bounties.createBounty(repoHash, issueNumber, "https://github.com/seichris/gh-bounties/issues/1");
        vm.prank(funder1);
        bounties.fundBountyETH{value: 1 ether}(bountyId, 0);

        uint256 nonce = bounties.payoutNonces(bountyId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(bountyId, address(0), dev, 0.1 ether, nonce, deadline);
        bounties.payoutWithAuthorization(bountyId, address(0), payable(dev), 0.1 ether, nonce, deadline, sig);

        vm.expectRevert(GHBounties.PayoutModeLocked.selector);
        vm.prank(funder1);
        bounties.funderPayout(bountyId, address(0), payable(dev), 0.1 ether);
    }
}
