flowchart LR

%% ===== Bootstrap =====
A[buildRootContainer] --> B[Root Container]
B --> C[Register Providers]
C --> C1[Logger]
C --> C2[Clock]
C --> C3[Config]
C --> C4[Greeter]
B --> D[Create Child]
B --> E[Resolve Greeter root]
D --> F[Resolve Greeter child]

%% ===== Resolve Pipeline =====
subgraph R[Container resolve token]
direction TB
R0[resolve token] --> R1{token in stack}
R1 -- yes --> X1[throw CircularDependencyError]
R1 -- no --> R2[get provider]
R2 --> R3{found}
R3 -- no --> X2[throw ProviderNotFoundError]
R3 -- yes --> R4[determine scope]
R4 --> R5{singleton and cached}
R5 -- yes --> R12[return cached instance]
R5 -- no --> R6[instantiate]
R6 --> R7[apply property injections]
R7 --> R8{has onInit}
R8 -- yes --> R9[call onInit]
R8 -- no --> R10[continue]
R9 --> R10
R10 --> R11{scope singleton}
R11 -- yes --> R13[cache instance]
R11 -- no --> R12[return instance]
R13 --> R12
end

%% ===== instantiate(provider) =====
subgraph I[instantiate provider]
direction TB
I0{provider type} --> IC[class provider]
I0 --> IF[factory provider]
I0 --> IV[value provider]
I0 --> IE[unknown]
IC --> I1[read inject]
I1 --> I2[resolve deps]
I2 --> I3[new class]
IF --> I4[resolve deps]
I4 --> I5[call factory]
IV --> I6[return value]
IE --> I7[throw ResolutionError]
end

R6 --> I0
