module ga
{
    export module threading
    {
        import GALogger = ga.logging.GALogger;
        import GAUtilities = ga.utilities.GAUtilities;
        import GAStore = ga.store.GAStore;
        import EGAStoreArgsOperator = ga.store.EGAStoreArgsOperator;
        import EGAStore = ga.store.EGAStore;
        import GAState = ga.state.GAState;
        import GAEvents = ga.events.GAEvents;
        import GAHTTPApi = ga.http.GAHTTPApi;

        export class GAThreading
        {
            private static readonly instance:GAThreading = new GAThreading();
            private readonly blocks:PriorityQueue<TimedBlock> = new PriorityQueue<TimedBlock>(<IComparer<number>>{
                compare: (x:number, y:number) => {
                    return x - y;
                }
            });
            private readonly id2TimedBlockMap:{[key:number]: TimedBlock} = {};
            private static runTimeoutId:number;
            private static readonly ThreadWaitTimeInMs:number = 1000;
            private static readonly ProcessEventsIntervalInSeconds:number = 8.0;
            private keepRunning:boolean;
            private isRunning:boolean;

            private constructor()
            {
                GALogger.d("Initializing GA thread...");
                GAThreading.startThread();
            }

            public static performTaskOnGAThread(taskBlock:() => void, delayInSeconds:number = 0): void
            {
                var time:Date = new Date();
                time.setSeconds(time.getSeconds() + delayInSeconds);

                var timedBlock = new TimedBlock(time, taskBlock);
                GAThreading.instance.id2TimedBlockMap[timedBlock.id] = timedBlock;
                GAThreading.instance.addTimedBlock(timedBlock);
            }

            public static scheduleTimer(interval:number, callback:() => void): number
            {
                var time:Date = new Date();
                time.setSeconds(time.getSeconds() + interval);

                var timedBlock:TimedBlock = new TimedBlock(time, callback);
                GAThreading.instance.id2TimedBlockMap[timedBlock.id] = timedBlock;
                GAThreading.instance.addTimedBlock(timedBlock);

                return timedBlock.id;
            }

            public static ensureEventQueueIsRunning(): void
            {
                GAThreading.instance.keepRunning = true;

                if(!GAThreading.instance.isRunning)
                {
                    GAThreading.instance.isRunning = true;
                    GAThreading.scheduleTimer(GAThreading.ProcessEventsIntervalInSeconds, GAThreading.processEventQueue);
                }
            }

            public static endSessionAndStopQueue(): void
            {
                if(GAState.isInitialized())
                {
                    GALogger.i("Ending session.");
                    GAThreading.stopEventQueue();
                    if (GAState.isEnabled() && GAState.sessionIsStarted())
                    {
                        GAEvents.addSessionEndEvent();
                        GAState.instance.sessionStart = 0;
                    }
                }
            }

            public static stopEventQueue(): void
            {
                GAThreading.instance.keepRunning = false;
            }

            public static ignoreTimer(blockIdentifier:number): void
            {
                if (blockIdentifier in GAThreading.instance.id2TimedBlockMap)
                {
                    GAThreading.instance.id2TimedBlockMap[blockIdentifier].ignore = true;
                }
            }

            private addTimedBlock(timedBlock:TimedBlock): void
            {
                this.blocks.enqueue(timedBlock.deadline.getTime(), timedBlock);
            }

            private static run(): void
            {
                clearTimeout(GAThreading.runTimeoutId);

                try
                {
                    var timedBlock:TimedBlock;

                    while ((timedBlock = GAThreading.getNextBlock()))
                    {
                        if (!timedBlock.ignore)
                        {
                            timedBlock.block();
                        }
                    }

                    GAThreading.runTimeoutId = setTimeout(GAThreading.run, GAThreading.ThreadWaitTimeInMs);
                    return;
                }
                catch (e)
                {
                    GALogger.e("Error on GA thread");
                    GALogger.e(e.stack);
                }
                GALogger.d("Ending GA thread");
            }

            private static startThread(): void
            {
                GALogger.d("Starting GA thread");
                GAThreading.runTimeoutId = setTimeout(GAThreading.run, 0);
            }

            private static getNextBlock(): TimedBlock
            {
                var now:Date = new Date();

                if (GAThreading.instance.blocks.hasItems() && GAThreading.instance.blocks.peek().deadline.getTime() <= now.getTime())
                {
                    return GAThreading.instance.blocks.dequeue();
                }

                return null;
            }

            private static processEventQueue(): void
            {
                GAEvents.processEvents("", true);
                if(GAThreading.instance.keepRunning)
                {
                    GAThreading.scheduleTimer(GAThreading.ProcessEventsIntervalInSeconds, GAThreading.processEventQueue);
                }
                else
                {
                    GAThreading.instance.isRunning = false;
                }
            }
        }
    }
}
