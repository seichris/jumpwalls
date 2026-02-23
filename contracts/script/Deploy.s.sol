// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {GHBounties} from "../src/GHBounties.sol";

contract Deploy is Script {
    function run() external returns (GHBounties deployed) {
        uint64 defaultLock = uint64(vm.envOr("DEFAULT_LOCK_SECONDS", uint256(7 days)));
        // Prefer deriving the authorizer address from the backend signer key so local dev can set one value.
        uint256 backendSignerKey = vm.envOr("BACKEND_SIGNER_PRIVATE_KEY", uint256(0));
        address payoutAuthorizer =
            backendSignerKey != 0 ? vm.addr(backendSignerKey) : vm.envOr("PAYOUT_AUTHORIZER", address(0));
        require(payoutAuthorizer != address(0), "payoutAuthorizer required (set BACKEND_SIGNER_PRIVATE_KEY or PAYOUT_AUTHORIZER)");
        address dao = vm.envOr("DAO_ADDRESS", address(0));
        uint64 daoDelaySeconds = uint64(vm.envOr("DAO_DELAY_SECONDS", uint256(0)));

        vm.startBroadcast();
        deployed = new GHBounties(defaultLock, payoutAuthorizer, dao, daoDelaySeconds);
        vm.stopBroadcast();
    }
}
